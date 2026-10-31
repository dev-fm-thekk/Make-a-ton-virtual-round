import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create account" };

export const instant = false; // see the note in app/layout.tsx

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-muted">See and manage your subscriptions and invoices.</p>
      <RegisterForm />
    </>
  );
}
