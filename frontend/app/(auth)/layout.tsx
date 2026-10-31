import { Repeat } from "lucide-react";
import { GuestOnly } from "@/components/auth/guest-only";

// Session lives in memory + an httpOnly cookie, so the server can't know who is signed in; this subtree
// renders after a client-side session check and is intentionally not "instant" (see lib/auth.tsx).
export const instant = false;

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="grid flex-1 lg:grid-cols-[1fr_1.1fr]">
      <aside className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Repeat className="size-6" aria-hidden /> Brightloop Billing
        </div>
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">Plans, subscriptions and recurring billing in one place.</h2>
          <p className="text-primary-foreground/80">No more spreadsheets, hand-typed invoices or end-of-quarter revenue scrambles.</p>
        </div>
        <p className="text-sm text-primary-foreground/70">© Brightloop Software</p>
      </aside>
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <GuestOnly>{children}</GuestOnly>
        </div>
      </div>
    </main>
  );
}
