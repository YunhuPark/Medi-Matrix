import { describe, it, expect, vi, afterEach } from 'vitest';
import { getWebSocketUrl } from '../lib/websocketUrl';

describe('websocketUrl tests', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses VITE_WS_BASE_URL if available', () => {
    vi.stubEnv('VITE_WS_BASE_URL', 'wss://custom.example.com/api/v1');
    const url = getWebSocketUrl();
    expect(url).toBe('wss://custom.example.com/api/v1/triage/stream');
  });

  it('normalizes http:// to ws://', () => {
    vi.stubEnv('VITE_WS_BASE_URL', 'http://custom.example.com/api/v1');
    const url = getWebSocketUrl();
    expect(url).toBe('ws://custom.example.com/api/v1/triage/stream');
  });

  it('normalizes https:// to wss://', () => {
    vi.stubEnv('VITE_WS_BASE_URL', 'https://custom.example.com/api/v1');
    const url = getWebSocketUrl();
    expect(url).toBe('wss://custom.example.com/api/v1/triage/stream');
  });

  it('removes trailing slashes', () => {
    vi.stubEnv('VITE_WS_BASE_URL', 'wss://custom.example.com/api/v1/');
    const url = getWebSocketUrl();
    expect(url).toBe('wss://custom.example.com/api/v1/triage/stream');
  });

  // Since we run in JSDOM, window.location might be available
  // To truly test fallback, we would mock window.location, but testing the logic with VITE_WS_BASE_URL covers the normalization.
});
