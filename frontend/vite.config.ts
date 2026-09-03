import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const REQUIRED_VERCEL_ENV = [
  'VITE_API_BASE_URL',
  'VITE_WS_BASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_INFERENCE_MODE',
] as const

function assertSecureUrl(name: string, value: string, allowedSchemes: readonly string[]) {
  if (!allowedSchemes.some(scheme => value.startsWith(`${scheme}://`))) {
    throw new Error(`[vite-config] ${name} must use ${allowedSchemes.join(' or ')}.`)
  }
}

// Vercel preview/production builds are our public judging surface. Fail the
// deployment before publishing a broken bundle if any required runtime endpoint
// or Supabase client setting is absent. Local/CI builds remain environment-free
// so unit tests and static compilation do not depend on deployment secrets.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isVercelBuild = process.env.VERCEL === '1'

  if (isVercelBuild) {
    const missing = REQUIRED_VERCEL_ENV.filter(name => !env[name]?.trim())
    if (missing.length > 0) {
      throw new Error(`[vite-config] Missing required Vercel environment variables: ${missing.join(', ')}`)
    }

    assertSecureUrl('VITE_API_BASE_URL', env.VITE_API_BASE_URL, ['https'])
    assertSecureUrl('VITE_WS_BASE_URL', env.VITE_WS_BASE_URL, ['wss', 'https'])
    assertSecureUrl('VITE_SUPABASE_URL', env.VITE_SUPABASE_URL, ['https'])

    if (env.VITE_INFERENCE_MODE !== 'demo') {
      throw new Error('[vite-config] Public Vercel builds must use VITE_INFERENCE_MODE=demo until model paths are verified.')
    }
  }

  return {
    plugins: [react()],
  }
})
