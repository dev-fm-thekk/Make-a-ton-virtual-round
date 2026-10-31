import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/auth/reset-form";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Reset password" };

export const instant = false; // see the note in app/layout.tsx

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Pick something you haven&apos;t used before.</p>
      {/* useSearchParams needs a Suspense boundary under Cache Components */}
      <Suspense fallback={<Spinner />}>
        <ResetForm />
      </Suspense>
    </>
  );
}
