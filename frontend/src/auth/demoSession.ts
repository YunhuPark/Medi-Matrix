import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

export class DemoSessionError extends Error {
  constructor(message: string = '인증 세션을 준비할 수 없습니다.') {
    super(message);
    this.name = 'DemoSessionError';
  }
}

let sessionPromise: Promise<Session> | null = null;

export const ensureDemoSession = async (): Promise<Session> => {
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      // 기존 유효한 세션(일반 계정 포함) 확인
      if (session && session.access_token && session.user?.id) {
        return session;
      }

      // 없거나 불완전하면 익명 세션 발급
      const { data, error } = await supabase.auth.signInAnonymously();
      
      if (error || !data.session || !data.session.access_token || !data.session.user?.id) {
        throw new DemoSessionError();
      }

      return data.session;
    } catch (e) {
      if (e instanceof DemoSessionError) {
        throw e;
      }
      throw new DemoSessionError();
    } finally {
      // 진행 완료(성공/실패) 후 락 해제하여 다음 번 재시도 가능하게 함
      sessionPromise = null;
    }
  })();

  return sessionPromise;
};
