import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Access token lives in memory only (never localStorage). The refresh token is
// an httpOnly cookie the JS can't read.
let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
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
        setAccessToken(data.accessToken);
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
