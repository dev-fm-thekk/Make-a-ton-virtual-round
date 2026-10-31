import {
  BadgePercent,
  BarChart3,
  CreditCard,
  FileText,
  LayoutDashboard,
  Layers,
  Package,
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

  { label: "Subscriptions", href: "/subscriptions", icon: Repeat, roles: ["ADMIN", "STAFF"], ready: false },
  { label: "Invoices", href: "/invoices", icon: Receipt, roles: ["ADMIN", "STAFF"], ready: false },
  { label: "Payments", href: "/payments", icon: CreditCard, roles: ["ADMIN", "STAFF"], ready: false },
  { label: "Customers", href: "/customers", icon: Users, roles: ["ADMIN", "STAFF"], ready: false },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["ADMIN", "STAFF"], ready: false },

  { label: "Products", href: "/products", icon: Package, roles: ["ADMIN", "STAFF"], ready: false },
  { label: "Plans", href: "/plans", icon: Layers, roles: ["ADMIN", "STAFF"], ready: false },
  { label: "Quotation templates", href: "/quotation-templates", icon: FileText, roles: ["ADMIN", "STAFF"], ready: false },
  { label: "Discounts", href: "/discounts", icon: BadgePercent, roles: ["ADMIN"], ready: false },
  { label: "Team & users", href: "/users", icon: UserCog, roles: ["ADMIN"], ready: true },

  { label: "My subscriptions", href: "/my/subscriptions", icon: Repeat, roles: ["CUSTOMER"], ready: false },
  { label: "My invoices", href: "/my/invoices", icon: Receipt, roles: ["CUSTOMER"], ready: false },

  { label: "Account", href: "/account", icon: UserRound, roles: ["ADMIN", "STAFF", "CUSTOMER"], ready: true },
];
