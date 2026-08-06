import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Access token lives in memory only (never localStorage). The refresh token is
// an httpOnly cookie the JS can't read.
let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
}

// ---- per-portal session tracking --------------------------------------------
// Refresh tokens are role-scoped cookies (gh_rt_<role>), so admin, employee and
// client can all be signed in at once in one browser — a login in one portal no
// longer overwrites another. Each tab remembers WHICH portal it is
// (sessionStorage, isolated per tab); a brand-new tab falls back to the last-used
// portal (localStorage) so a normal single-user reload still auto-restores. The
// role is sent on refresh so the server rotates the correct cookie.
const ROLE_KEY = 'gh_role';
const LAST_ROLE_KEY = 'gh_last_role';
export function setPortalRole(role) {
  try {
    if (role) { sessionStorage.setItem(ROLE_KEY, role); localStorage.setItem(LAST_ROLE_KEY, role); }
  } catch { /* private mode */ }
}
export function getPortalRole() {
  try {
    return sessionStorage.getItem(ROLE_KEY) || localStorage.getItem(LAST_ROLE_KEY) || null;
  } catch {
    return null;
  }
}
export function clearPortalRole() {
  // Clear only THIS tab's binding — keep last-used so a fresh tab can still restore.
  try { sessionStorage.removeItem(ROLE_KEY); } catch { /* ignore */ }
}
export function portalRoleHeader() {
  const role = getPortalRole();
  return role ? { 'X-Portal-Role': role } : {};
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
          axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true, headers: portalRoleHeader() });
        const { data } = await refreshPromise;
        refreshPromise = null;

        setAccessToken(data.accessToken);
        setPortalRole(data.user?.role);
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
