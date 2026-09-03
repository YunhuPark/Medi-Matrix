import { describe, it, expect, vi, beforeEach } from 'vitest';
import { medicalApi, MEDICAL_API_TIMEOUT_MS, processMedicalMask } from '../api/medicalApi';
import { ensureDemoSession, DemoSessionError } from '../auth/demoSession';
import axios from 'axios';

vi.mock('../auth/demoSession', () => ({
  ensureDemoSession: vi.fn(),
  DemoSessionError: class extends Error {
    constructor(message: string = 'DemoSessionError') {
      super(message);
      this.name = 'DemoSessionError';
    }
  }
}));

describe('medicalApi tests', () => {
  let adapterMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    adapterMock = vi.fn().mockResolvedValue({
      data: { status: 'success', glb_url: 'http://test', patient_id: 'p1', mesh_id: 'm1', expires_at: 123 },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    });
    medicalApi.defaults.adapter = adapterMock;

    // Clear global axios adapter too just in case
    axios.defaults.adapter = vi.fn().mockResolvedValue({ data: {} });
  });

  it('configures a finite timeout so stalled backend requests cannot hang the UI forever', () => {
    expect(MEDICAL_API_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    expect(medicalApi.defaults.timeout).toBe(MEDICAL_API_TIMEOUT_MS);
  });

  it('rejects missing session before making network requests', async () => {
    (ensureDemoSession as any).mockRejectedValue(new DemoSessionError('Authentication required. Failed to acquire demo session.'));

    await expect(processMedicalMask(new File([], 'test.npy'))).rejects.toThrow('Authentication required. Failed to acquire demo session.');

    expect(adapterMock).not.toHaveBeenCalled(); // 0 network calls
  });

  it('adds Authorization header when session exists', async () => {
    (ensureDemoSession as any).mockResolvedValue({ access_token: 'fake-token' });

    await processMedicalMask(new File([], 'test.npy'));

    expect(adapterMock).toHaveBeenCalledTimes(1);
    const config = adapterMock.mock.calls[0][0];
    expect(config.headers.Authorization).toBe('Bearer fake-token');
  });

  it('rejects external absolute URLs to prevent token leak', async () => {
    (ensureDemoSession as any).mockResolvedValue({ access_token: 'fake-token' });

    await expect(medicalApi.get('https://evil.example.com/steal-token')).rejects.toThrow('Blocked: medicalApi must not make requests to external URLs.');

    expect(adapterMock).not.toHaveBeenCalled(); // 0 network calls
  });

  it('rejects protocol-relative URLs (e.g. //evil.example.com)', async () => {
    (ensureDemoSession as any).mockResolvedValue({ access_token: 'fake-token' });

    await expect(medicalApi.get('//evil.example.com/steal-token')).rejects.toThrow('Blocked: medicalApi must not make requests to external URLs.');
    expect(adapterMock).not.toHaveBeenCalled();
  });

  it('allows relative paths based on API_BASE_URL', async () => {
    (ensureDemoSession as any).mockResolvedValue({ access_token: 'fake-token' });

    await medicalApi.get('/some-relative-path');

    expect(adapterMock).toHaveBeenCalledTimes(1);
    const config = adapterMock.mock.calls[0][0];
    expect(config.url).toBe('/some-relative-path');
  });

  it('does not leak Authorization into global axios', async () => {
    (ensureDemoSession as any).mockResolvedValue({ access_token: 'fake-token' });

    // Make a successful medicalApi call
    await medicalApi.get('/safe-path');

    // Now make a global axios call
    const globalAdapterMock = vi.fn().mockResolvedValue({ data: {} });
    axios.defaults.adapter = globalAdapterMock;

    await axios.get('https://example.com');

    const config = globalAdapterMock.mock.calls[0][0];
    expect(config.headers?.Authorization).toBeUndefined();
  });
});
