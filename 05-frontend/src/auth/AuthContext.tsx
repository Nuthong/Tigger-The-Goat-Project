import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { auth, setAccessToken, AUTH_EXPIRED_EVENT } from "../lib/api";
import type { User } from "../lib/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (body: {
    username: string;
    email: string;
    password: string;
    first_name: string;
    last_name: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** re-pull `/auth/me` (e.g. after editing the profile) */
  refreshMe: () => Promise<void>;
  /** signed in as anyone other than a guest */
  isStaff: boolean;
  /** manager or admin - reports, rate plans, audit */
  isManager: boolean;
  /** admin only - user accounts */
  isAdmin: boolean;
  /** reservation desk - bookings, check-in/out, payments, room status, guests */
  canFrontDesk: boolean;
  /** cleaning board + maintenance triage */
  canHousekeeping: boolean;
  /** invoices ledger + financial reports */
  canAccounting: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load, try to resume the session via the refresh cookie.
  useEffect(() => {
    (async () => {
      try {
        if (await auth.refresh()) setUser(await auth.me());
      } catch {
        /* not logged in - fine */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // The API client fires this when a 401 can no longer be refreshed away.
  useEffect(() => {
    const onExpired = () => {
      setAccessToken(null);
      setUser(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const t = await auth.login(username, password);
    setAccessToken(t.access_token);
    setUser(await auth.me());
  }, []);

  const register = useCallback(
    async (body: {
      username: string;
      email: string;
      password: string;
      first_name: string;
      last_name: string;
    }) => {
      const t = await auth.register(body);
      setAccessToken(t.access_token);
      setUser(await auth.me());
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const refreshMe = useCallback(async () => {
    setUser(await auth.me());
  }, []);

  const value = useMemo<AuthState>(() => {
    const role = user?.role ?? null;
    const inRole = (...roles: string[]) => role != null && roles.includes(role);
    return {
      user,
      loading,
      login,
      register,
      logout,
      refreshMe,
      isStaff: role != null && role !== "customer",
      isManager: inRole("manager", "admin"),
      isAdmin: inRole("admin"),
      canFrontDesk: inRole("receptionist", "manager", "admin"),
      canHousekeeping: inRole("housekeeping", "manager", "admin"),
      canAccounting: inRole("accounting", "manager", "admin"),
    };
  }, [user, loading, login, register, logout, refreshMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
