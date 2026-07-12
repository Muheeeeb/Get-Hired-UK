import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { api, API_BASE, setAccessToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // Silent session restore via the refresh cookie.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, {}, { withCredentials: true });
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        // not logged in
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
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
