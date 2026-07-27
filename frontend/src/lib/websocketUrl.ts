/**
 * Dynamically resolves the WebSocket URL for the application.
 */
export function getWebSocketUrl(): string {
  const envUrl = import.meta.env.VITE_WS_BASE_URL;
  let baseUrl = '';

  if (envUrl) {
    baseUrl = envUrl;
  } else {
    // Disable localhost fallback in production
    if (import.meta.env.PROD) {
      throw new Error("VITE_WS_BASE_URL is required in production environment.");
    }
    // Fallback to same-origin for development
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
    baseUrl = `${protocol}//${host}`;
  }

  // Normalize HTTP(S) to WS(S)
  if (baseUrl.startsWith('http://')) {
    baseUrl = baseUrl.replace('http://', 'ws://');
  } else if (baseUrl.startsWith('https://')) {
    baseUrl = baseUrl.replace('https://', 'wss://');
  }

  // Remove trailing slashes
  baseUrl = baseUrl.replace(/\/+$/, '');

  // Normalize path to prevent duplication
  if (baseUrl.endsWith('/api/v1/triage/stream')) {
    return baseUrl;
  }
  if (baseUrl.endsWith('/triage/stream')) {
    return baseUrl.slice(0, -14) + '/api/v1/triage/stream';
  }
  if (baseUrl.endsWith('/api/v1')) {
    return `${baseUrl}/triage/stream`;
  }
  
  return `${baseUrl}/api/v1/triage/stream`;
}
