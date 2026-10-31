import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export const instant = false; // see the note in app/layout.tsx

export default function DashboardPage() {
  return <DashboardView />;
}
