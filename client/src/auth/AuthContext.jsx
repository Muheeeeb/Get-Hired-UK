import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  api, API_BASE, setAccessToken,
  setSessionUid, clearSessionUid, isForeignSession,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // Silent session restore via the refresh cookie (runs on every page load).
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
        // If this tab remembers a different account than the cookie now points
        // to, do NOT restore it — that would be the account-swap bug. Leave the
        // tab logged out (but KEEP its bound identity, so every subsequent
        // reload keeps refusing the wrong account) → guard redirects to login.
        if (isForeignSession(data.user?.id)) {
          setAccessToken(null);
        } else {
          setAccessToken(data.accessToken);
          setSessionUid(data.user.id);
          setUser(data.user);
        }
      } catch {
        // not logged in
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    // Session ended (refresh failed or a foreign account was refused). Drop the
    // in-memory user, but leave the tab's bound identity intact — clearing it
    // only on an explicit sign-out is what stops a later reload from adopting a
    // different account that owns the shared cookie.
    const onLogout = () => setUser(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setSessionUid(data.user.id);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      clearSessionUid();
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, booting, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
