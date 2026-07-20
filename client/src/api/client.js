import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Access token lives in memory only (never localStorage). The refresh token is
// an httpOnly cookie the JS can't read.
let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
}

// ---- per-tab identity guard --------------------------------------------------
// The refresh_token cookie is shared across the whole browser, so if two
// accounts are used in one browser the cookie ends up pointing at whichever
// logged in last. Without a guard, a silent refresh (on token expiry OR page
// reload) would adopt that OTHER account — the reported "refresh swaps me into
// a different account" bug. We remember, PER TAB (sessionStorage survives
// reloads but is isolated per tab), which user this tab belongs to and refuse
// to adopt a refreshed session for a different user.
const UID_KEY = 'gh_uid';
export function setSessionUid(id) {
  try {
    if (id) sessionStorage.setItem(UID_KEY, id);
  } catch { /* private mode */ }
}
export function getSessionUid() {
  try {
    return sessionStorage.getItem(UID_KEY);
  } catch {
    return null;
  }
}
export function clearSessionUid() {
  try {
    sessionStorage.removeItem(UID_KEY);
  } catch { /* ignore */ }
}

/** True if a refreshed session belongs to a different account than this tab. */
export function isForeignSession(refreshedUserId) {
  const expected = getSessionUid();
  const foreign = Boolean(expected && refreshedUserId && refreshedUserId !== expected);
  if (foreign) {
    try {
      sessionStorage.setItem(
        'gh_signout_reason',
        'You were signed out because a different account was used in this browser. Please sign in again.'
      );
    } catch { /* ignore */ }
  }
  return foreign;
}

export function takeSignoutReason() {
  try {
    const r = sessionStorage.getItem('gh_signout_reason');
    if (r) sessionStorage.removeItem('gh_signout_reason');
    return r;
  } catch {
    return null;
  }
}

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshPromise = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    if (status === 401 && !original._retried && !original.url.startsWith('/auth/')) {
      original._retried = true;
      try {
        refreshPromise =
          refreshPromise ||
          axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
        const { data } = await refreshPromise;
        refreshPromise = null;

        // The shared cookie now belongs to a DIFFERENT account (another tab
        // logged in). Never silently swap — sign this tab out cleanly instead.
        if (isForeignSession(data.user?.id)) {
          setAccessToken(null);
          window.dispatchEvent(new Event('auth:logout'));
          throw new Error('Session changed');
        }

        setAccessToken(data.accessToken);
        if (data.user?.id) setSessionUid(data.user.id);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        refreshPromise = null;
        setAccessToken(null);
        window.dispatchEvent(new Event('auth:logout'));
        throw refreshErr;
      }
    }
    throw error;
  }
);

export function errorMessage(err, fallback = 'Something went wrong') {
  return err?.response?.data?.error || err?.message || fallback;
}
