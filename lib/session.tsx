'use client';

/**
 * Who is signed in, and what they are allowed to do.
 *
 * Permissions come back with the session from the API and are the same strings the server
 * checks in `ae_require_perm()`, so a screen can hide what a request would refuse anyway.
 * Hiding is a courtesy, not a control — the server is still the authority on every call.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, getToken, setToken } from './api';

export type SessionUser = {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl?: string | null;
};

type SessionState = {
  loading: boolean;
  user: SessionUser | null;
  tenant: Tenant | null;
  permissions: string[];
  can: (...keys: string[]) => boolean;
  signOut: () => void;
  reload: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export type Tenant = { id: string; slug: string; name: string | null };

type ProfileResponse = {
  user?: SessionUser;
  tenant?: Tenant;
  roles?: string[];
  permissions?: string[];
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);

  async function load() {
    if (!getToken()) {
      setUser(null);
      setPermissions([]);
      setLoading(false);
      return;
    }
    try {
      const res = await api<ProfileResponse>('/identity/me', { quiet: true });
      setUser(res.user ?? null);
      setTenant(res.tenant ?? null);
      setPermissions(Array.isArray(res.permissions) ? res.permissions : []);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'session_required' || err.code === 'session_invalid')) {
        setToken(null);
      }
      setUser(null);
      setTenant(null);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      loading,
      user,
      tenant,
      permissions,
      can: (...keys: string[]) => keys.some((k) => permissions.includes(k)),
      signOut: () => {
        setToken(null);
        window.location.href = '/login/';
      },
      reload: load,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, user, tenant, permissions],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
