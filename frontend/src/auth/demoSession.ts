import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

const DEFAULT_DEMO_SESSION_TIMEOUT_MS = 12_000;
const configuredTimeout = Number(
  import.meta.env.VITE_DEMO_SESSION_TIMEOUT_MS ?? DEFAULT_DEMO_SESSION_TIMEOUT_MS,
);

export const DEMO_SESSION_TIMEOUT_MS = Number.isFinite(configuredTimeout)
  ? Math.max(1_000, configuredTimeout)
  : DEFAULT_DEMO_SESSION_TIMEOUT_MS;

export class DemoSessionError extends Error {
  code: 'timeout' | 'auth';

  constructor(
    message: string = '인증 세션을 준비할 수 없습니다.',
    code: 'timeout' | 'auth' = 'auth',
  ) {
    super(message);
    this.name = 'DemoSessionError';
    this.code = code;
  }
}

let sessionPromise: Promise<Session> | null = null;

const withTimeout = async <T>(label: string, operation: PromiseLike<T>): Promise<T> => {
  const operationPromise = Promise.resolve(operation);
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(
        new DemoSessionError(
          `${label} 응답이 ${Math.round(DEMO_SESSION_TIMEOUT_MS / 1000)}초 안에 오지 않았습니다.`,
          'timeout',
        ),
      );
    }, DEMO_SESSION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timerId) clearTimeout(timerId);
  }
};

export const ensureDemoSession = async (): Promise<Session> => {
  if (sessionPromise) {
    return sessionPromise;
  }

  sessionPromise = (async () => {
    try {
      const {
        data: { session },
      } = await withTimeout('기존 Demo 세션 확인', supabase.auth.getSession());

      // 기존 유효한 세션(일반 계정 포함) 확인
      if (session && session.access_token && session.user?.id) {
        return session;
      }

      // 없거나 불완전하면 익명 세션 발급
      const { data, error } = await withTimeout(
        'Supabase 익명 로그인',
        supabase.auth.signInAnonymously(),
      );

      if (error || !data.session || !data.session.access_token || !data.session.user?.id) {
        throw new DemoSessionError();
      }

      return data.session;
    } catch (error) {
      if (error instanceof DemoSessionError) {
        throw error;
      }
      throw new DemoSessionError();
    } finally {
      // 진행 완료(성공/실패) 후 락 해제하여 다음 번 재시도 가능하게 함
      sessionPromise = null;
    }
  })();

  return sessionPromise;
};
