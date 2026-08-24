import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'

const pubKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
if (!pubKey.startsWith('sb_publishable_')) {
  throw new Error("Invalid Supabase Publishable Key format. Must start with 'sb_publishable_'. Initialization refused.");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
)
