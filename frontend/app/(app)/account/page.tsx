import type { Metadata } from "next";
import { AccountView } from "@/components/account-view";

export const metadata: Metadata = { title: "Account" };

export const instant = false; // see the note in app/layout.tsx

export default function AccountPage() {
  return <AccountView />;
}
