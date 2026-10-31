"use client";

import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { Card } from "./ui";

/**
 * UX guard for a section of the app: people without the role see a clear message instead of a page full of
 * 403 errors. It is NOT the security boundary: every API route enforces roles itself.
 */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null; // AppShell already redirects anonymous users
  if (!roles.includes(user.role)) {
    return (
      <Card className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <ShieldAlert className="size-8 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold">You don&apos;t have access to this page</h1>
        <p className="text-sm text-muted">Ask an administrator if you think this is a mistake.</p>
      </Card>
    );
  }
  return <>{children}</>;
}
