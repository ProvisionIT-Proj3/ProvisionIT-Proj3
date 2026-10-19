import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// null until both keys are in .env, then the portal skips login
export const supabase = url && key ? createClient(url, key) : null;
