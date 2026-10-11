import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

const Ctx = createContext(null);
const KEY = 'provisionit.activeConnection';

const readSaved = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export function ConnectionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', connections: [], error: null });
  const [savedId, setSavedId] = useState(readSaved);

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading', error: null }));
    return api
      .listConnections()
      .then((res) => setState({ status: 'ready', connections: res.items, error: null }))
      .catch((error) => setState({ status: 'error', connections: [], error }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const select = useCallback((id) => {
    setSavedId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // storage blocked, selection just won't persist
    }
  }, []);

  const active = state.connections.find((c) => c.id === savedId) ?? state.connections[0] ?? null;

  return <Ctx.Provider value={{ ...state, active, select, reload: load }}>{children}</Ctx.Provider>;
}

export const useConnection = () => useContext(Ctx);
