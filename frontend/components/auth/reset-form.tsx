"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { post } from "@/lib/api";
import { applyApiError } from "@/lib/forms";
import { passwordSchema } from "@/lib/password";
import { PasswordField } from "../password-field";
import { Alert, Button } from "../ui";

const schema = z.object({ password: passwordSchema });
type Values = z.infer<typeof schema>;

export function ResetForm() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const password = useWatch({ control, name: "password", defaultValue: "" });

  if (!token) {
    return (
      <div className="space-y-4">
        <Alert>This reset link is missing its token. Request a new one.</Alert>
        <Link href="/forgot-password" className="block text-center text-sm font-medium text-primary hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await post("/auth/reset-password", { token, password }, false);
      toast.success("Password updated. Please sign in.");
      router.replace("/login");
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert>{formError}</Alert>}
      <PasswordField label="New password" autoComplete="new-password" autoFocus watchValue={password ?? ""} error={errors.password?.message} {...register("password")} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Update password
      </Button>
    </form>
  );
}
