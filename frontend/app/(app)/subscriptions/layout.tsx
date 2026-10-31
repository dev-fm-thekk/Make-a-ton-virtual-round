import { RequireRole } from "@/components/require-role";

export default function SubscriptionsLayout({ children }: LayoutProps<"/">) {
  return <RequireRole roles={["ADMIN", "STAFF"]}>{children}</RequireRole>;
}
