import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { bootstrapTransferDemoCase } from '../api/medicalApi';
import { ensureDemoSession } from '../auth/demoSession';

vi.mock('../auth/demoSession', () => ({
  ensureDemoSession: vi.fn(),
  DemoSessionError: class extends Error {
    constructor(message: string = 'DemoSessionError') {
      super(message);
      this.name = 'DemoSessionError';
    }
  }
}));

vi.mock('../api/medicalApi', () => ({
  bootstrapTransferDemoCase: vi.fn(),
  createCaseContext: vi.fn(),
  getSignedUrl: vi.fn(),
  processMedicalMaskForCase: vi.fn(),
  uploadVitalsForCase: vi.fn(),
}));

vi.mock('../components/viewer/ThreeViewer', () => ({
  ThreeViewer: () => <div data-testid="three-viewer">ThreeViewer</div>
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
}));

vi.mock('../lib/websocketUrl', () => ({
  getCaseWebSocketUrl: vi.fn((caseId: string) => `ws://test.local/api/v1/cases/${caseId}/triage/stream`),
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.onclose?.({ code: 1000 } as CloseEvent);
  });

  constructor(url: string | URL) {
    this.url = String(url);
    MockWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.(new Event('open'));
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  disconnect(code = 1006) {
    this.onclose?.({ code } as CloseEvent);
  }
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

const demoResponse = {
  status: 'success' as const,
  case_id: 'MM-TEST1234',
  scenario: 'ed_interhospital_transfer_support' as const,
  scenario_label: '지역 응급실 → 상급병원 전원 지원',
  data_mode: 'synthetic_bundled_demo' as const,
  clinical_identifier: false as const,
  vitals_attached: true as const,
  image: {
    status: 'success',
    message: 'ok',
    glb_url: 'https://example.com/model.glb',
    signed_url: 'https://example.com/model.glb',
    mesh_id: 'mesh-test',
    expires_in: 3600,
    expires_at: 4_102_444_800,
    patient_id: 'MM-TEST1234',
    case_id: 'MM-TEST1234',
    identifier_type: 'non_phi_demo_case' as const,
    clinical_identifier: false as const,
    lesion_volume: 1234,
  },
  integration_target: {
    imaging: 'PACS/DICOM',
    vitals: 'EMR/FHIR or bedside monitor',
    encounter: 'protected hospital Encounter',
  },
};

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    vi.mocked(ensureDemoSession).mockResolvedValue({ access_token: 'test-access-token' } as never);
    vi.mocked(bootstrapTransferDemoCase).mockResolvedValue(demoResponse);
  });

  it('첫 방문에서 로그인 화면 없이 전원 지원 제품 UI가 즉시 표시됨', async () => {
    renderApp();

    expect(await screen.findByText('Medi-Matrix')).toBeInTheDocument();
    expect(screen.getByText(/중증환자의 영상·Vitals를 전원 의사결정까지 연결/i)).toBeInTheDocument();
    expect(screen.queryByText('Medi-Matrix 로그인')).not.toBeInTheDocument();
  });

  it('직접 의료영상 + Vitals 업로드가 메인 시연 흐름으로 기본 노출됨', async () => {
    renderApp();

    expect(await screen.findByTestId('manual-upload-flow')).toBeInTheDocument();
    expect(screen.getByText(/메인 시연 · 직접 Case 구성/i)).toBeInTheDocument();
    expect(screen.getByTestId('image-upload-button')).toHaveTextContent('1. 의료영상 업로드 · Case 생성');
    expect(screen.getByTestId('vitals-upload-button')).toHaveTextContent('2. Vitals CSV 업로드 · 같은 Case 연결');
    expect(screen.getByTestId('monitoring-button')).toHaveTextContent('3. Case Vitals 모니터링 시작');
    expect(screen.getByText(/PACS·EMR에서 들어올 입력을 의료영상 파일과 Vitals CSV 업로드로 재현/i)).toBeInTheDocument();
  });

  it('샘플 Case 원클릭은 백업 시연으로 분리됨', async () => {
    renderApp();

    expect(await screen.findByText(/백업 시연 · 샘플 Case 빠른 실행/i)).toBeInTheDocument();
    expect(screen.getByTestId('demo-case-button')).toHaveTextContent('샘플 Case 빠른 실행');
    expect(screen.queryByText('Demo Case 한 번에 실행')).not.toBeInTheDocument();
  });

  it('세션 초기화 버튼을 사용할 수 있음', async () => {
    renderApp();

    const resetButton = await screen.findByText('데모 세션 초기화');
    fireEvent.click(resetButton);
    expect(await screen.findByText('Medi-Matrix')).toBeInTheDocument();
  });

  it('demo 모드를 실제 병원 연동이나 임상 AI 진단으로 표현하지 않음', async () => {
    renderApp();

    expect(await screen.findByText(/실제 병원 시스템 연동이 아니라/i)).toBeInTheDocument();
    expect(screen.getByText(/임상 진단 또는 자동 전원 결정 시스템이 아닙니다/i)).toBeInTheDocument();
    expect(screen.queryByText(/Real-Data Ready/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/실제 환자 데이터 스트리밍/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PyTorch Inference/i)).not.toBeInTheDocument();
  });

  it('WebSocket 재연결 중에도 마지막 Vitals, Triage, Golden-Time 진입점을 유지함', async () => {
    renderApp();

    fireEvent.click(await screen.findByTestId('demo-case-button'));

    expect(await screen.findByText('MM-TEST1234')).toBeInTheDocument();
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    const socket = MockWebSocket.instances[0];
    act(() => socket.open());

    act(() => {
      socket.message({
        vitals: {
          hr: 128,
          bp_sys: 82,
          bp_dia: 50,
          resp: 28,
          temp: 38.7,
          spo2: 89,
        },
        disease_risks: {
          sepsis: '0.84',
          ards: '0.78',
          shock: '0.81',
        },
        decision: {
          policy: 'demo_transfer_policy_v1',
          clinical_rule: false,
          vitals_risk: 0.82,
          vision_context: 0.08,
          triage_score: 0.90,
          yellow_threshold: 0.25,
          red_threshold: 0.75,
        },
        triggering_condition: 'systemic_deterioration',
        sepsis_high_risk: true,
        triage_level: 'RED',
      });
    });

    expect(await screen.findByText(/HR 128 bpm/)).toBeInTheDocument();
    expect(screen.getByText(/RED \(초응급 - 전신 악화 위험\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /RED · 긴급 전원 병원 탐색/i })).toBeEnabled();
    expect(screen.getByText('0.90')).toBeInTheDocument();

    act(() => socket.disconnect(1006));

    expect(await screen.findByText(/재연결 중 · 마지막 정상 Vitals 값을 유지하고 있습니다/i)).toBeInTheDocument();
    expect(screen.getByTestId('vitals-panel')).toHaveTextContent('HR 128 bpm');
    expect(screen.getByTestId('triage-panel')).toHaveTextContent('RED (초응급 - 전신 악화 위험)');
    expect(screen.getByRole('button', { name: /RED · 긴급 전원 병원 탐색/i })).toBeEnabled();
  });
});
