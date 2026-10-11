import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setTokenProvider } from '../api/http';
import { getSupabase, isAuthEnabled } from './supabaseClient';

const Ctx = createContext(null);

// status: 'loading' (checking for a saved session), 'signedOut', 'signedIn',
// or 'open' (login is not configured, the API is called without a token)
const toState = (session) =>
  session ? { status: 'signedIn', email: session.user?.email ?? '' } : { status: 'signedOut', email: '' };

export function AuthProvider({ children }) {
  const enabled = isAuthEnabled();
  const [state, setState] = useState(enabled ? { status: 'loading', email: '' } : { status: 'open', email: '' });

  useEffect(() => {
    if (!enabled) return undefined;
    const supabase = getSupabase();
    let active = true;

    // Read the session on every call: supabase hands back a refreshed token
    // when the saved one has expired.
    setTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    supabase.auth
      .getSession()
      .then(({ data }) => active && setState(toState(data.session)))
      .catch(() => active && setState(toState(null)));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState(toState(session));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
      setTokenProvider(async () => null);
    };
  }, [enabled]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
    setState(toState(data.session));
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setState(toState(null));
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
