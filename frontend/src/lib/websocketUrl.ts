/**
 * Dynamically resolves the WebSocket URL for the application.
 *
 * The legacy endpoint is kept for backwards compatibility. New competition
 * flows should use getCaseWebSocketUrl(caseId) so the Vitals replay is bound to
 * the same non-PHI Case ID as the MRI context.
 */
function resolveWebSocketBaseUrl(): string {
  const envUrl = import.meta.env.VITE_WS_BASE_URL;
  let baseUrl = '';

  if (envUrl) {
    baseUrl = envUrl;
  } else {
    if (import.meta.env.PROD) {
      throw new Error('VITE_WS_BASE_URL is required in production environment.');
    }
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const protocol = isHttps ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
    baseUrl = `${protocol}//${host}`;
  }

  if (baseUrl.startsWith('http://')) {
    baseUrl = baseUrl.replace('http://', 'ws://');
  } else if (baseUrl.startsWith('https://')) {
    baseUrl = baseUrl.replace('https://', 'wss://');
  }

  baseUrl = baseUrl.replace(/\/+$/, '');

  if (baseUrl.endsWith('/api/v1/triage/stream')) {
    return baseUrl.slice(0, -'/api/v1/triage/stream'.length);
  }
  if (baseUrl.endsWith('/triage/stream')) {
    return baseUrl.slice(0, -'/triage/stream'.length);
  }
  if (baseUrl.endsWith('/api/v1')) {
    return baseUrl.slice(0, -'/api/v1'.length);
  }
  return baseUrl;
}

export function getWebSocketUrl(): string {
  return `${resolveWebSocketBaseUrl()}/api/v1/triage/stream`;
}

export function getCaseWebSocketUrl(caseId: string): string {
  if (!/^MM-[A-Z0-9]{8}$/i.test(caseId)) {
    throw new Error('Invalid Case ID.');
  }
  return `${resolveWebSocketBaseUrl()}/api/v1/cases/${encodeURIComponent(caseId.toUpperCase())}/triage/stream`;
}
