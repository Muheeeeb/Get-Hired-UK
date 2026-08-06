import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  api, API_BASE, setAccessToken,
  setPortalRole, clearPortalRole, portalRoleHeader,
} from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // Silent session restore via this portal's refresh cookie (runs on every page
  // load). The tab tells the server which portal it is so the right cookie is used.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.post(
          `${API_BASE}/auth/refresh`, {},
          { withCredentials: true, headers: portalRoleHeader() }
        );
        setAccessToken(data.accessToken);
        setPortalRole(data.user.role);
        setUser(data.user);
      } catch {
        // not logged in
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    // Session ended (refresh failed). Drop the in-memory user for this tab.
    const onLogout = () => setUser(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setPortalRole(data.user.role);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { headers: portalRoleHeader() });
    } finally {
      setAccessToken(null);
      clearPortalRole();
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
