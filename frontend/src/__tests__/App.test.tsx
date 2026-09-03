import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../auth/demoSession', () => ({
  ensureDemoSession: vi.fn(),
  DemoSessionError: class extends Error {
    constructor(message: string = 'DemoSessionError') {
      super(message);
      this.name = 'DemoSessionError';
    }
  }
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

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('첫 방문에서 로그인 화면 없이 전원 지원 제품 UI가 즉시 표시됨', async () => {
    renderApp();

    expect(await screen.findByText('Medi-Matrix')).toBeInTheDocument();
    expect(screen.getByText(/중증환자의 영상·Vitals를 전원 의사결정까지 연결/i)).toBeInTheDocument();
    expect(screen.queryByText('Medi-Matrix 로그인')).not.toBeInTheDocument();
  });

  it('심사위원용 원클릭 Demo Case 진입점을 기본 노출함', async () => {
    renderApp();

    expect(await screen.findByTestId('demo-case-button')).toBeInTheDocument();
    expect(screen.getByText('Demo Case 한 번에 실행')).toBeInTheDocument();
    expect(screen.getByText(/지역 응급실 → 상급병원 전원 지원/i)).toBeInTheDocument();
    expect(screen.getByText(/PACS·EMR 연동 전 단계/i)).toBeInTheDocument();
  });

  it('직접 파일 업로드는 보조 MVP 입력 어댑터로 접혀 있음', async () => {
    renderApp();

    const summary = await screen.findByText(/직접 파일로 테스트/i);
    expect(summary).toBeInTheDocument();
    expect(screen.getByText(/MVP 입력 어댑터/i)).toBeInTheDocument();
  });

  it('세션 초기화 버튼을 사용할 수 있음', async () => {
    renderApp();

    const resetButton = await screen.findByText('데모 세션 초기화');
    fireEvent.click(resetButton);
    expect(await screen.findByText('Medi-Matrix')).toBeInTheDocument();
  });

  it('demo 모드를 임상 AI 진단으로 표현하지 않음', async () => {
    renderApp();

    expect(await screen.findByText(/임상 진단 또는 자동 전원 결정 시스템이 아닙니다/i)).toBeInTheDocument();
    expect(screen.queryByText(/Real-Data Ready/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/실제 환자 데이터 스트리밍/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PyTorch Inference/i)).not.toBeInTheDocument();
  });
});
