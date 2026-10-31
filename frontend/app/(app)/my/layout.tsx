import { RequireRole } from "@/components/require-role";

export default function PortalLayout({ children }: LayoutProps<"/">) {
  return <RequireRole roles={["CUSTOMER"]}>{children}</RequireRole>;
}
