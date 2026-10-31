import { RequireRole } from "@/components/require-role";
import { ReportsFrame } from "@/features/reports/reports-tabs";

export default function ReportsLayout({ children }: LayoutProps<"/">) {
  return (
    <RequireRole roles={["ADMIN", "STAFF"]}>
      <ReportsFrame>{children}</ReportsFrame>
    </RequireRole>
  );
}
