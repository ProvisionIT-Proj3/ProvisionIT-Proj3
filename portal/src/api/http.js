const BASE = import.meta.env.VITE_API_URL || '/api/v1';

let tokenProvider = async () => null;

// the login code can plug a Supabase token in here later
export function setTokenProvider(fn) {
  tokenProvider = fn;
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, params = {}) {
  const url = new URL(BASE + path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const headers = { Accept: 'application/json' };
  const token = await tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { method, headers });
  } catch {
    throw new ApiError('Network error', 0, 'NETWORK');
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // body wasn't json
  }

  if (!res.ok) throw new ApiError(body?.error?.message || body?.message || res.statusText, res.status, body?.error?.code);
  return body;
}

export const get = (path, params) => request('GET', path, params);
// the middleware reads connectionId from the query string, so params go there too
export const post = (path, params) => request('POST', path, params);
