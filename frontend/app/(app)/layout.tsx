import { AppShell } from "@/components/app-shell";

// Session lives in memory + an httpOnly cookie, so the server can't know who is signed in; this subtree
// renders after a client-side session check and is intentionally not "instant" (see lib/auth.tsx).
export const instant = false;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
