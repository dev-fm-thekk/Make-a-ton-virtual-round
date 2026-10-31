import {
  BadgePercent,
  BarChart3,
  CalendarClock,
  Clock,
  CreditCard,
  FileText,
  LayoutDashboard,
  Layers,
  Package,
  Percent,
  Receipt,
  Repeat,
  UserCog,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  /** false → shown disabled with a "Soon" tag. Flip to true when you ship the page. */
  ready: boolean;
}

// ONE place to register a new screen in the sidebar. Teammates: create app/(app)/<route>/page.tsx,
// then set `ready: true` for your entry.
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "STAFF", "CUSTOMER"], ready: true },

  { label: "Subscriptions", href: "/subscriptions", icon: Repeat, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Invoices", href: "/invoices", icon: Receipt, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Billing", href: "/billing", icon: CalendarClock, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Payments", href: "/payments", icon: CreditCard, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Customers", href: "/customers", icon: Users, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["ADMIN", "STAFF"], ready: true },

  { label: "Products", href: "/products", icon: Package, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Plans", href: "/plans", icon: Layers, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Quotation templates", href: "/quotation-templates", icon: FileText, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Taxes", href: "/taxes", icon: Percent, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Payment terms", href: "/payment-terms", icon: Clock, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Discounts", href: "/discounts", icon: BadgePercent, roles: ["ADMIN", "STAFF"], ready: true },
  { label: "Team & users", href: "/users", icon: UserCog, roles: ["ADMIN"], ready: true },

  { label: "My subscriptions", href: "/my/subscriptions", icon: Repeat, roles: ["CUSTOMER"], ready: true },
  { label: "My invoices", href: "/my/invoices", icon: Receipt, roles: ["CUSTOMER"], ready: true },

  { label: "Account", href: "/account", icon: UserRound, roles: ["ADMIN", "STAFF", "CUSTOMER"], ready: true },
];
