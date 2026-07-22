import { useEffect, useRef, useCallback } from 'react';

interface UseSignedUrlRefreshOptions {
  meshId: string | null;
  expiresAt: number | null;
  onRefresh: (meshId: string) => Promise<void>;
  onError: (error: string) => void;
}

export function useSignedUrlRefresh({ meshId, expiresAt, onRefresh, onError }: UseSignedUrlRefreshOptions) {
  const timeoutRef = useRef<number | null>(null);
  const isRefreshingRef = useRef<boolean>(false);
  const retryCountRef = useRef<number>(0);
  
  // To detect if mesh changed during an async operation
  const currentMeshRef = useRef<string | null>(meshId);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const triggerRefresh = useCallback(async (isRetry = false) => {
    if (!meshId) return;
    
    // Prevent overlapping refreshes
    if (isRefreshingRef.current && !isRetry) return;
    
    isRefreshingRef.current = true;
    try {
      await onRefresh(meshId);
      // On success, reset retry count
      retryCountRef.current = 0;
    } catch (error) {
      if (currentMeshRef.current !== meshId) {
        // Mesh changed during refresh, ignore
        isRefreshingRef.current = false;
        return;
      }
      
      if (retryCountRef.current === 0) {
        retryCountRef.current = 1;
        // Retry immediately once
        await triggerRefresh(true);
      } else {
        // Failed twice
        onError("Signed URL 갱신에 최종 실패했습니다.");
        retryCountRef.current = 0; // Reset for future attempts if any
      }
    } finally {
      isRefreshingRef.current = false;
    }
  }, [meshId, onRefresh, onError]);

  // Handle manual trigger (e.g., from GLB load failure)
  const handleLoadFailure = useCallback(() => {
    if (!meshId || isRefreshingRef.current) return;
    triggerRefresh();
  }, [meshId, triggerRefresh]);

  useEffect(() => {
    currentMeshRef.current = meshId;
    clearTimer();
    retryCountRef.current = 0;
    isRefreshingRef.current = false;

    if (!meshId || !expiresAt) return;

    const setupTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const targetTime = expiresAt - 30; // 30 seconds before expiration
      const delay = (targetTime - now) * 1000;

      if (delay <= 0) {
        // Already passed or about to pass, trigger immediately
        triggerRefresh();
      } else {
        timeoutRef.current = window.setTimeout(() => {
          triggerRefresh();
        }, delay);
      }
    };

    setupTimer();

    return clearTimer;
  }, [meshId, expiresAt, triggerRefresh, clearTimer]);

  return { triggerRefresh, handleLoadFailure };
}
