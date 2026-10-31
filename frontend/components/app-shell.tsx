"use client";

import clsx from "clsx";
import { LogOut, Menu, Repeat, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { Badge, Button, Spinner } from "./ui";

const ROLE_LABEL = { ADMIN: "Admin", STAFF: "Staff", CUSTOMER: "Customer" } as const;

/** Client-side route guard + sidebar layout for every signed-in screen. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

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

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5 text-base font-semibold">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Repeat className="size-4" aria-hidden />
        </span>
        Brightloop
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
          return (
            <li key={item.href}>
              {item.ready ? (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(base, active ? "bg-primary/10 font-medium text-primary" : "text-muted hover:bg-surface-2 hover:text-foreground")}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              ) : (
                <span aria-disabled className={clsx(base, "cursor-not-allowed text-muted/50")}>
                  <Icon className="size-4" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Soon</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border p-3">
        <div className="mb-2 px-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <div className="mt-1.5">
            <Badge tone="primary">{ROLE_LABEL[user.role]}</Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => void logout()}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="flex flex-1">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-surface lg:block">{sidebar}</aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside onClick={() => setOpen(false)} className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl">{sidebar}</aside>
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
