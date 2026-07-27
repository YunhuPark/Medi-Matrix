import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureDemoSession, DemoSessionError } from '../auth/demoSession';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signInAnonymously: vi.fn(),
    }
  }
}));

describe('demoSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('기존 유효한 세션이 있으면 signInAnonymously를 호출하지 않음', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: { access_token: 'test_token', user: { id: 'test_id' } } }
    });

    const session = await ensureDemoSession();
    expect(session.access_token).toBe('test_token');
    expect(supabase.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('기존 유효한 세션이 없으면 signInAnonymously를 호출하여 새 세션 발급', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
    (supabase.auth.signInAnonymously as any).mockResolvedValue({
      data: { session: { access_token: 'new_token', user: { id: 'new_id' } } },
      error: null
    });

    const session = await ensureDemoSession();
    expect(session.access_token).toBe('new_token');
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('동시 요청 시 signInAnonymously는 한 번만 호출됨', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
    
    // 지연을 주어 동시 호출 시뮬레이션
    let resolveSignIn: any;
    const signInPromise = new Promise((resolve) => {
      resolveSignIn = resolve;
    });
    
    (supabase.auth.signInAnonymously as any).mockImplementation(() => signInPromise);

    const promise1 = ensureDemoSession();
    const promise2 = ensureDemoSession();
    
    resolveSignIn({
      data: { session: { access_token: 'concurrent_token', user: { id: 'new_id' } } },
      error: null
    });

    const [session1, session2] = await Promise.all([promise1, promise2]);
    expect(session1.access_token).toBe('concurrent_token');
    expect(session2.access_token).toBe('concurrent_token');
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('세션 발급 실패 시 DemoSessionError 예외가 발생하고 락이 해제됨', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
    (supabase.auth.signInAnonymously as any).mockResolvedValue({
      data: { session: null },
      error: new Error('Network Error')
    });

    await expect(ensureDemoSession()).rejects.toThrow(DemoSessionError);

    // 락 해제 검증: 다음 요청 시도
    (supabase.auth.signInAnonymously as any).mockResolvedValue({
      data: { session: { access_token: 'retry_token', user: { id: 'retry_id' } } },
      error: null
    });

    const session = await ensureDemoSession();
    expect(session.access_token).toBe('retry_token');
    expect(supabase.auth.signInAnonymously).toHaveBeenCalledTimes(2);
  });
});
