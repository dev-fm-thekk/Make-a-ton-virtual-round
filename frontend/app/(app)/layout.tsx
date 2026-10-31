import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadingState } from "@/components/data/list-parts";

export const instant = false; // see the note in app/layout.tsx

export default function AppLayout({ children }: LayoutProps<"/">) {
  // The shell reads usePathname(), which isn't known while prerendering dynamic routes like /customers/[id].
  // Cache Components requires a Suspense boundary above any such client hook.
  return (
    <Suspense fallback={<LoadingState />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
