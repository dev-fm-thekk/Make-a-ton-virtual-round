"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { Badge, Card, PageHeader } from "./ui";

// Placeholder landing page. Package 8 (Reporting) replaces the "coming up" grid with the finance
// dashboard: active subscriptions, revenue, outstanding, overdue invoices.
export function DashboardView() {
  const { user } = useAuth();
  if (!user) return null;

  const items = NAV.filter((n) => n.roles.includes(user.role) && n.href !== "/dashboard" && n.href !== "/account");

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description={user.role === "CUSTOMER" ? "Your subscriptions and invoices will appear here." : "Everything you need to run recurring billing, in one place."}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          const inner = (
            <Card className={`flex h-full items-center gap-4 p-5 ${item.ready ? "transition-colors hover:border-primary" : "opacity-60"}`}>
              <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="flex-1 font-medium">{item.label}</span>
              {item.ready ? <ArrowRight className="size-4 text-muted" aria-hidden /> : <Badge>Soon</Badge>}
            </Card>
          );
          return item.ready ? (
            <Link key={item.href} href={item.href}>
              {inner}
            </Link>
          ) : (
            <div key={item.href}>{inner}</div>
          );
        })}
      </div>
    </>
  );
}
