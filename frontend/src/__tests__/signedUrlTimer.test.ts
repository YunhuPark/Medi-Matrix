import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSignedUrlRefresh } from '../hooks/useSignedUrlRefresh';

describe('useSignedUrlRefresh hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('triggers refresh 30 seconds before expiration', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    
    // Expires in 100 seconds from now
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 100;

    renderHook(() => useSignedUrlRefresh({
      meshId: 'test-mesh',
      expiresAt,
      onRefresh,
      onError
    }));

    // Fast forward 69 seconds -> should not trigger yet
    vi.advanceTimersByTime(69 * 1000);
    expect(onRefresh).not.toHaveBeenCalled();

    // Fast forward 1 second (now 70 seconds elapsed, 30s before expiration)
    vi.advanceTimersByTime(1 * 1000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith('test-mesh');
  });

  it('retries exactly once on failure, then calls onError', async () => {
    // Fail first time, fail second time
    const onRefresh = vi.fn().mockRejectedValue(new Error('Network error'));
    const onError = vi.fn();

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 100;

    renderHook(() => useSignedUrlRefresh({
      meshId: 'test-mesh',
      expiresAt,
      onRefresh,
      onError
    }));

    // Trigger timer
    vi.advanceTimersByTime(70 * 1000);

    // Wait for promise rejections to settle
    await vi.runAllTimersAsync();

    expect(onRefresh).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Signed URL 갱신에 최종 실패했습니다.");
  });

  it('refreshes immediately on handleLoadFailure', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 100;

    const { result } = renderHook(() => useSignedUrlRefresh({
      meshId: 'test-mesh',
      expiresAt,
      onRefresh,
      onError
    }));

    result.current.handleLoadFailure();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('clears timer on unmount', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 100;

    const { unmount } = renderHook(() => useSignedUrlRefresh({
      meshId: 'test-mesh',
      expiresAt,
      onRefresh,
      onError: vi.fn()
    }));
    
    unmount();
    
    vi.advanceTimersByTime(70 * 1000);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
