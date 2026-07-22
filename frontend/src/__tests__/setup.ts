import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Create a global mock for supabase to be used across all tests
const mockGetSession = vi.fn()
const mockAuth = {
  getSession: mockGetSession,
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signOut: vi.fn(),
}

vi.mock('../lib/supabase', () => {
  return {
    supabase: {
      auth: mockAuth,
    }
  }
})

// Set global env for tests
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000/api/v1')
