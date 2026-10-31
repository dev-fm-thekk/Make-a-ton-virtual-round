import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadingState } from "@/components/data/list-parts";

// Session lives in memory + an httpOnly cookie, so the server can't know who is signed in; this subtree
// renders after a client-side session check and is intentionally not "instant" (see lib/auth.tsx).
export const instant = false;

export default function AppLayout({ children }: LayoutProps<"/">) {
  // The shell reads usePathname(), which isn't known while prerendering dynamic routes like /customers/[id].
  // Cache Components requires a Suspense boundary above any such client hook.
  return (
    <Suspense fallback={<LoadingState />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
