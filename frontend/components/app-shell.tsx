"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, LogOut, Menu, Repeat, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { Badge, Spinner } from "./ui";

const ROLE_LABEL = { ADMIN: "Admin", STAFF: "Staff", CUSTOMER: "Customer" } as const;
const COLLAPSE_KEY = "sidebar-collapsed";

// Per-viewer convenience only: storage may be blocked, so every access is guarded.
function readCollapsed() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Smooth collapse = the layout never switches. Icons sit in a fixed column on the left; only the
 * sidebar WIDTH animates and labels fade, so nothing reflows or jumps mid-transition.
 */
function Label({ hidden, className, children }: { hidden: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden={hidden || undefined}
      className={clsx("whitespace-nowrap transition-opacity duration-150 motion-reduce:transition-none", hidden ? "opacity-0" : "opacity-100 delay-100", className)}
    >
      {children}
    </span>
  );
}

/** Client-side route guard + sidebar layout for every signed-in screen. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The shell only renders its sidebar after the client-side session check, never in server HTML,
  // so reading storage in the initializer cannot cause a hydration mismatch.
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated" || !user) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(user.role));
  const initial = user.name.slice(0, 1).toUpperCase();

  // `compact` only fades labels; geometry is identical in both states.
  const renderSidebar = (compact: boolean) => (
    <nav aria-label="Main" className="flex h-full flex-col overflow-hidden">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 text-base font-semibold">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Repeat className="size-4" aria-hidden />
        </span>
        <Label hidden={compact}>Brightloop</Label>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const base = "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm";
          return (
            <li key={item.href}>
              {item.ready ? (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={compact ? item.label : undefined}
                  title={compact ? item.label : undefined}
                  className={clsx(base, active ? "bg-primary/10 font-medium text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground")}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <Label hidden={compact}>{item.label}</Label>
                </Link>
              ) : (
                <span aria-disabled title={compact ? `${item.label} (soon)` : undefined} className={clsx(base, "cursor-not-allowed text-muted/50")}>
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <Label hidden={compact} className="flex flex-1 items-center justify-between gap-3">
                    {item.label}
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
                  </Label>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 space-y-1 border-t border-border p-2">
        <div className="flex items-center gap-3 px-2 py-2" title={compact ? `${user.name} · ${ROLE_LABEL[user.role]}` : undefined}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initial}</span>
          <Label hidden={compact} className="min-w-0">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted">{user.email}</span>
            <span className="mt-1 block">
              <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
            </span>
          </Label>
        </div>
        <button
          onClick={() => void logout()}
          aria-label="Sign out"
          title={compact ? "Sign out" : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          <Label hidden={compact}>Sign out</Label>
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex flex-1">
      <aside
        className={clsx(
          "sticky top-0 hidden h-screen shrink-0 border-r border-border bg-surface transition-[width] duration-200 ease-in-out motion-reduce:transition-none lg:block",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {renderSidebar(collapsed)}
        {/* edge handle: lives outside the clipped nav so it can overhang the border */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-5 z-10 grid size-6 place-items-center rounded-full border border-border bg-surface text-muted shadow-sm hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
        </button>
      </aside>

      {/* mobile drawer (always expanded) */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside onClick={() => setOpen(false)} className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl">
            {renderSidebar(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button onClick={() => setOpen((o) => !o)} aria-label={open ? "Close menu" : "Open menu"} className="rounded-lg p-2 hover:bg-surface-2">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="font-semibold">Brightloop</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
