import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import { useViewerStore } from '../store/useViewerStore';

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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useViewerStore.getState().resetMedicalState();
  });

  it('첫 방문에서 전원 지원 제품 시나리오가 즉시 표시됨', async () => {
    renderApp();

    expect(await screen.findByText('Medi-Matrix')).toBeInTheDocument();
    expect(screen.getByText(/현실 타깃: 지역 응급실 → 상급병원 전원 지원/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Demo Case 한 번에 실행/i })).toBeInTheDocument();
    expect(screen.queryByText('Medi-Matrix 로그인')).not.toBeInTheDocument();
  });

  it('Case 초기화 시 Case 상태가 초기화됨', async () => {
    useViewerStore.getState().setCaseId('MM-A1B2C3D4');
    useViewerStore.getState().setPatientId('MM-A1B2C3D4');
    renderApp();

    expect(await screen.findByText('MM-A1B2C3D4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Case 초기화' }));

    expect(await screen.findByText('아직 생성되지 않음')).toBeInTheDocument();
    expect(screen.getByText('Medi-Matrix')).toBeInTheDocument();
  });

  it('공개 데모 한계와 실제 연동 목표를 명확히 표시함', async () => {
    renderApp();

    expect(await screen.findByText(/합성 입력 기반 공모전 프로토타입 · 임상 진단\/전원 지시 시스템 아님/i)).toBeInTheDocument();
    expect(screen.getByText(/PACS·EMR\/환자모니터 연동 전 MVP 입력 어댑터/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /수동 영상 Context 업로드/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /같은 Case에 Vitals 연결/i })).toBeInTheDocument();

    expect(screen.queryByText(/Real-Data Ready/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/실제 환자 데이터 스트리밍/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/최적 병원/i)).not.toBeInTheDocument();
  });
});
