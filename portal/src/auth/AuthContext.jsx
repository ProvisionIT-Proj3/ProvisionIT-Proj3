import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setTokenProvider } from '../api/http';
import { supabase } from './supabase';

// status: loading | in | out | off (off = no login needed)
const Ctx = createContext({ status: 'off', user: null });

// sample data or missing Supabase keys means no login
const loginOff = () => import.meta.env.VITE_USE_MOCK === 'true' || !supabase;

const fromSession = (session) => (session ? { status: 'in', user: session.user } : { status: 'out', user: null });

export function AuthProvider({ children }) {
  const off = loginOff();
  const [state, setState] = useState(off ? { status: 'off', user: null } : { status: 'loading', user: null });

  useEffect(() => {
    if (off) return undefined;

    // getSession refreshes an expired token before handing it back
    setTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    supabase.auth
      .getSession()
      .then(({ data }) => setState(fromSession(data.session)))
      .catch(() => setState(fromSession(null)));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState(fromSession(session)));
    return () => data.subscription.unsubscribe();
  }, [off]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
