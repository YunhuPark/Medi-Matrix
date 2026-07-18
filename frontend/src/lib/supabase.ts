import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase URL or Publishable Key is missing!");
}

if (supabaseKey.startsWith('sb_secret') || supabaseKey.includes('service_role')) {
    throw new Error("SECURITY BREACH: VITE_SUPABASE_PUBLISHABLE_KEY contains a secret key!");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
