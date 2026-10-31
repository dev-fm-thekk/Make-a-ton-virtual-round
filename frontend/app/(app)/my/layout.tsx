import { RequireRole } from "@/components/require-role";

export const instant = false; // see the note in app/layout.tsx

export default function PortalLayout({ children }: LayoutProps<"/">) {
  return <RequireRole roles={["CUSTOMER"]}>{children}</RequireRole>;
}
