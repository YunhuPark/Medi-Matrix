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

const queryClient = new QueryClient();

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('첫 방문에서 로그인 화면 없이 제품 UI가 즉시 표시됨', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByText('Medical Image 3D Viewer')).toBeInTheDocument();
    expect(screen.queryByText('Medi-Matrix 로그인')).not.toBeInTheDocument();
  });

  it('세션 초기화 시 상태가 초기화됨', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    const logoutBtn = await screen.findByText('데모 세션 초기화');
    fireEvent.click(logoutBtn);
    expect(await screen.findByText('Medical Image 3D Viewer')).toBeInTheDocument();
  });

  it('demo 모드에서 실제 AI 진단으로 오해할 문구가 표시되지 않고 합성 데모 안내가 표시됨', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    );

    expect(await screen.findByText(/임상적 검증을 거치지 않은 공모전용 프로토타입/i)).toBeInTheDocument();
    expect(await screen.findByText(/심사위원 시연 순서/i)).toBeInTheDocument();
    expect(await screen.findByText(/1단계: .* 합성 3D 의료영상 업로드/i)).toBeInTheDocument();
    expect(await screen.findByText(/2단계: 합성 Vitals 시계열 업로드/i)).toBeInTheDocument();

    expect(screen.queryByText(/Real-Data Ready/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/실제 환자 데이터 스트리밍/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PyTorch Inference/i)).not.toBeInTheDocument();
  });
});
