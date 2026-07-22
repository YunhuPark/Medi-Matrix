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

  it('does not duplicate /triage/stream if already present', () => {
    vi.stubEnv('VITE_WS_BASE_URL', 'wss://custom.example.com/api/v1/triage/stream');
    const url = getWebSocketUrl();
    expect(url).toBe('wss://custom.example.com/api/v1/triage/stream');
  });

  it('falls back to window.location if env variable is absent', () => {
    // Vitest runs in JSDOM, window.location defaults to http://localhost:3000 (vitest default is often localhost:3000)
    // We can temporarily mock window to be safe
    const url = getWebSocketUrl();
    expect(url).toBe('ws://localhost:3000/api/v1/triage/stream');
  });

  it('uses wss:// on https pages when falling back', () => {
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = { ...originalLocation, protocol: 'https:', host: 'example.com' } as any;
    
    const url = getWebSocketUrl();
    expect(url).toBe('wss://example.com/api/v1/triage/stream');
    
    // @ts-ignore
    window.location = originalLocation;
  });
});
