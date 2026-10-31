import type { Metadata } from "next";
import { UsersView } from "@/components/users/users-view";

export const metadata: Metadata = { title: "Team & users" };

export const instant = false; // see the note in app/layout.tsx

export default function UsersPage() {
  return <UsersView />;
}
