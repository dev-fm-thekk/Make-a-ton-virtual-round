"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { applyApiError } from "@/lib/forms";
import { passwordSchema } from "@/lib/password";
import { PasswordField } from "./password-field";
import { Alert, Badge, Button, Card, PageHeader } from "./ui";

const schema = z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: passwordSchema });
type Values = z.infer<typeof schema>;

export function AccountView() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const newPassword = useWatch({ control, name: "newPassword", defaultValue: "" });

  if (!user) return null;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await post("/auth/change-password", values);
      reset();
      toast.success("Password changed. Please sign in again.");
      await logout(); // the API revoked every session
      router.replace("/login");
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <>
      <PageHeader title="Account" description="Your profile and security settings." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Profile</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium">{user.name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Email</dt>
              <dd className="font-medium">{user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Role</dt>
              <dd>
                <Badge tone="primary">{user.role.toLowerCase()}</Badge>
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Change password</h2>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {formError && <Alert>{formError}</Alert>}
            <PasswordField label="Current password" autoComplete="current-password" error={errors.currentPassword?.message} {...register("currentPassword")} />
            <PasswordField label="New password" autoComplete="new-password" watchValue={newPassword ?? ""} error={errors.newPassword?.message} {...register("newPassword")} />
            <Button type="submit" loading={isSubmitting}>
              Update password
            </Button>
            <p className="text-xs text-muted">You&apos;ll be signed out everywhere after changing your password.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
