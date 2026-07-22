/**
 * Dynamically resolves the WebSocket URL for the application.
 */
export function getWebSocketUrl(): string {
  const envUrl = import.meta.env.VITE_WS_BASE_URL;
  let baseUrl = '';

  if (envUrl) {
    baseUrl = envUrl;
  } else {
    // Fallback to same-origin with standard API path
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
    baseUrl = `${protocol}//${host}/api/v1`;
  }

  // Normalize HTTP(S) to WS(S)
  if (baseUrl.startsWith('http://')) {
    baseUrl = baseUrl.replace('http://', 'ws://');
  } else if (baseUrl.startsWith('https://')) {
    baseUrl = baseUrl.replace('https://', 'wss://');
  }

  // Remove trailing slashes
  baseUrl = baseUrl.replace(/\/+$/, '');

  if (baseUrl.endsWith('/triage/stream')) {
    return baseUrl;
  }
  
  return `${baseUrl}/triage/stream`;
}
