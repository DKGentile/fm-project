/**
 * Customer auth state for the chat. Persists to sessionStorage so a page reload
 * keeps you logged in (until the tab closes or the server restarts).
 */

import { useCallback, useState } from 'react';
import { login as apiLogin, logout as apiLogout, type PublicCustomer } from '../lib/api';

export interface AuthSession {
  token: string;
  customer: PublicCustomer;
}

const STORAGE_KEY = 'northwind.auth';

function readStored(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthSession | null>(readStored);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    const session: AuthSession = { token: result.token, customer: result.customer };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* storage may be unavailable; in-memory auth still works */
    }
    setAuth(session);
  }, []);

  const logout = useCallback(() => {
    setAuth((cur) => {
      if (cur) void apiLogout(cur.token);
      return null;
    });
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }, []);

  return { auth, login, logout };
}
