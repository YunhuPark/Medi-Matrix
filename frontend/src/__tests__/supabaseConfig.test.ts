import { describe, it, expect } from 'vitest'

describe('Supabase Config tests', () => {
  const validateSupabaseConfig = (url: string, key: string, isProd: boolean) => {
    if (!key.startsWith('sb_publishable_')) {
      throw new Error("Invalid Supabase Publishable Key format. Must start with 'sb_publishable_'. Initialization refused.");
    }
    if (key.startsWith('sb_secret_') || key.includes('service_role')) {
      throw new Error("SECURITY BREACH: VITE_SUPABASE_PUBLISHABLE_KEY contains a secret key!");
    }
    if (isProd && url.startsWith('http://') && !url.includes('localhost')) {
      throw new Error("Production Supabase URL must use HTTPS.");
    }
    return true
  }

  it('16. sb_publishable_ allowed', () => {
    expect(validateSupabaseConfig('https://valid.supabase.co', 'sb_publishable_123', true)).toBe(true)
  })

  it('17. sb_secret_ rejected', () => {
    expect(() => validateSupabaseConfig('https://valid.supabase.co', 'sb_secret_123', true)).toThrow('Must start with \'sb_publishable_\'')
  })

  it('18. anon/service_role rejected', () => {
    expect(() => validateSupabaseConfig('https://valid.supabase.co', 'sb_publishable_service_role', true)).toThrow('SECURITY BREACH')
  })

  it('19. Prod HTTP URL rejected', () => {
    expect(() => validateSupabaseConfig('http://valid.supabase.co', 'sb_publishable_123', true)).toThrow('Production Supabase URL must use HTTPS')
  })

  it('20. localhost HTTP allowed', () => {
    expect(validateSupabaseConfig('http://localhost:8000', 'sb_publishable_123', false)).toBe(true)
  })
})
