import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setAuthToken } from '../api/client';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync('auth_token');
        if (token) {
          setAuthToken(token);
          const { user: me } = await api.me(); // also validates expiry
          setUser(me);
        }
      } catch {
        setAuthToken(null);
        await SecureStore.deleteItemAsync('auth_token').catch(() => {});
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const login = async (email, password) => {
    const { token, user: me } = await api.login(email.trim(), password);
    setAuthToken(token);
    await SecureStore.setItemAsync('auth_token', token);
    setUser(me);
  };

  const logout = async () => {
    setAuthToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync('auth_token').catch(() => {});
  };

  return (
    <AuthContext.Provider value={{ user, booting, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}
