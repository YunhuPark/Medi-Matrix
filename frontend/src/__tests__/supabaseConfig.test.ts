import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateSupabaseConfig } from '../lib/supabaseConfig';

describe('supabaseConfig tests', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects missing URL or Key', () => {
    const res = validateSupabaseConfig('', 'sb_publishable_123');
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Supabase URL or Key is missing.');
  });

  it('rejects secret keys absolutely', () => {
    const res = validateSupabaseConfig('https://test.supabase.co', 'sb_secret_123');
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Secret keys are not allowed on the frontend.');
  });

  it('rejects service role keys absolutely', () => {
    const res = validateSupabaseConfig('https://test.supabase.co', 'service_role_key');
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Secret keys are not allowed on the frontend.');
  });

  it('allows sb_publishable_ keys', () => {
    const res = validateSupabaseConfig('https://test.supabase.co', 'sb_publishable_123');
    expect(res.isValid).toBe(true);
  });

  it('allows legacy JWT keys (eyJ...)', () => {
    const res = validateSupabaseConfig('https://test.supabase.co', 'eyJhb.123.456');
    expect(res.isValid).toBe(true);
  });

  it('rejects invalid key formats (arbitrary strings)', () => {
    const res = validateSupabaseConfig('https://test.supabase.co', 'random_string_not_valid');
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Invalid Supabase key format.');
  });

  it('enforces HTTPS in production', () => {
    vi.stubEnv('PROD', true);
    
    // http://localhost is allowed
    let res = validateSupabaseConfig('http://localhost:54321', 'sb_publishable_123');
    expect(res.isValid).toBe(true);
    
    // http://test is NOT allowed
    res = validateSupabaseConfig('http://test.supabase.co', 'sb_publishable_123');
    expect(res.isValid).toBe(false);
    expect(res.error).toBe('Insecure HTTP Supabase URL is not allowed in production.');
  });
});
