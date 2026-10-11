import { useEffect, useState } from 'react';

export function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// runs fetcher whenever deps change, ignores answers that arrive late
export function useList(fetcher, deps) {
  const [state, setState] = useState({ status: 'loading', items: [], pagination: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    fetcher()
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', items: res.items, pagination: res.pagination, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', items: [], pagination: null, error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
