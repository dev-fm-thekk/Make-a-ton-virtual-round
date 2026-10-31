import { RequireRole } from "@/components/require-role";

export const instant = false; // see the note in app/layout.tsx

export default function InvoicesLayout({ children }: LayoutProps<"/">) {
  return <RequireRole roles={["ADMIN", "STAFF"]}>{children}</RequireRole>;
}
