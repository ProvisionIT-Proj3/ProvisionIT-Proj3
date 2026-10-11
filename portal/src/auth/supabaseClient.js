import { createClient } from '@supabase/supabase-js';

// Login is only switched on when both values are set, so a plain `npm run dev`
// against a local API with AUTH_REQUIRED=false keeps working with no login.
// Sample-data mode never asks for a login either.
export function isAuthEnabled() {
  return (
    import.meta.env.VITE_USE_MOCK !== 'true' &&
    Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  );
}

let client;

// Only ever the anon key here. The service role key must never reach the browser.
// The client keeps the session in localStorage and refreshes the token itself.
export function getSupabase() {
  if (!client) {
    client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
  }
  return client;
}
