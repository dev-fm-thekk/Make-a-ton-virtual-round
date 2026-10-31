import { RequireRole } from "@/components/require-role";

export default function CustomersLayout({ children }: LayoutProps<"/">) {
  return <RequireRole roles={["ADMIN", "STAFF"]}>{children}</RequireRole>;
}
