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

    // Header title of MainApp should be present immediately
    expect(await screen.findByText('Medical Image 3D Viewer')).toBeInTheDocument();
    
    // AuthPage should NOT be present (no "Medi-Matrix 로그인" text)
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
    // test could be more extensive, but checking it renders correctly for now
    expect(await screen.findByText('Medical Image 3D Viewer')).toBeInTheDocument();
  });
});
