import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from '../lib/api';
import type { Crest, Me } from '../types';

interface RegisterInput {
  email: string;
  password: string;
  managerName: string;
  teamName: string;
  favoriteClubId?: number | null;
  crest?: Crest;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  register: (input: RegisterInput) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
  setUser: (user: Me) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return;
    }
    try {
      setUser(await api.get<Me>('/auth/me'));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    const onLogout = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener('pf:logout', onLogout);
    return () => window.removeEventListener('pf:logout', onLogout);
  }, [refresh, queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      refresh,
      setUser,
      login: async (email, password) => {
        const res = await api.post<{ token: string; user: Me }>('/auth/login', { email, password });
        tokenStore.set(res.token);
        queryClient.clear();
        setUser(res.user);
        return res.user;
      },
      register: async (input) => {
        const res = await api.post<{ token: string; user: Me }>('/auth/register', input);
        tokenStore.set(res.token);
        queryClient.clear();
        setUser(res.user);
        return res.user;
      },
      logout: () => {
        tokenStore.clear();
        queryClient.clear();
        setUser(null);
      },
    }),
    [user, loading, refresh, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
