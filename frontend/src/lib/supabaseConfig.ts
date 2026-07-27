/**
 * Validates Supabase configuration before client initialization.
 */
export function validateSupabaseConfig(url: string | undefined, key: string | undefined): { isValid: boolean; error?: string } {
  if (!url || !key) {
    return { isValid: false, error: 'Supabase URL or Key is missing.' };
  }

  // Reject secret keys absolutely
  if (key.includes('sb_secret_') || key.includes('service_role')) {
    return { isValid: false, error: 'Secret keys are not allowed on the frontend.' };
  }

  // Check valid key formats
  // We allow 'sb_publishable_' and legacy JWT format (eyJ...) which might be used as anon keys in older Supabase setups
  const isPublishable = key.startsWith('sb_publishable_');
  const isLegacyJwt = key.startsWith('eyJ') && key.split('.').length === 3;
  
  if (!isPublishable && !isLegacyJwt) {
    return { isValid: false, error: 'Invalid Supabase key format.' };
  }

  // Enforce HTTPS in production, unless it's a localhost testing environment
  const isProduction = import.meta.env.PROD;
  if (isProduction && url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    return { isValid: false, error: 'Insecure HTTP Supabase URL is not allowed in production.' };
  }

  return { isValid: true };
}
