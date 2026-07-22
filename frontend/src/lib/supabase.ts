import { createClient } from '@supabase/supabase-js';
import { validateSupabaseConfig } from './supabaseConfig';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

const validation = validateSupabaseConfig(supabaseUrl, supabaseKey);

if (!validation.isValid) {
  throw new Error(`SECURITY/CONFIG BREACH: ${validation.error}`);
}

export const supabase = createClient(supabaseUrl, supabaseKey);
