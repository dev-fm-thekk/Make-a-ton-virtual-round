"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onSessionExpired, post, refreshSession, setAccessToken } from "./api";
import type { SessionResponse, SessionUser } from "./types";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthValue {
  user: SessionUser | null;
  status: Status;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (input: { name: string; email: string; password: string; companyName?: string; phone?: string }) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const queryClient = useQueryClient();
  const router = useRouter();

  const adopt = useCallback((s: SessionResponse) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
    setStatus("authenticated");
    return s.user;
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus("anonymous");
    queryClient.clear(); // never leak one user's cached data to the next
  }, [queryClient]);

  // Restore the session on page load from the httpOnly refresh cookie.
  useEffect(() => {
    let alive = true;
    refreshSession()
      .then((s) => {
        if (!alive) return;
        if (s) adopt(s);
        else setStatus("anonymous");
      })
      .catch(() => alive && setStatus("anonymous"));
    return () => {
      alive = false;
    };
  }, [adopt]);

  // A refresh that fails mid-session (revoked, expired, deactivated) → back to login.
  useEffect(
    () =>
      onSessionExpired(() => {
        clear();
        router.replace("/login");
      }),
    [clear, router],
  );

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      login: async (email, password) => adopt(await post<SessionResponse>("/auth/login", { email, password }, false)),
      register: async (input) => adopt(await post<SessionResponse>("/auth/register", input, false)),
      logout: async () => {
        await post("/auth/logout", {}, false).catch(() => undefined);
        clear();
        router.replace("/login");
      },
    }),
    [user, status, adopt, clear, router],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
