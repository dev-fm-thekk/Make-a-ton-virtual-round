"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { post } from "@/lib/api";
import { applyApiError } from "@/lib/forms";
import { emailSchema } from "@/lib/password";
import { Alert, Button, Input } from "../ui";

const schema = z.object({ email: emailSchema });
type Values = z.infer<typeof schema>;

export function ForgotForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await post("/auth/forgot-password", { email }, false);
      setSentTo(email);
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  if (sentTo) {
    return (
      <div className="space-y-4">
        <Alert tone="success">If an account exists for {sentTo}, a reset link is on its way. It expires in 1 hour.</Alert>
        <Link href="/login" className="block text-center text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert>{formError}</Alert>}
      <Input label="Email" type="email" autoComplete="email" autoFocus error={errors.email?.message} {...register("email")} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Send reset link
      </Button>
      <Link href="/login" className="block text-center text-sm text-muted hover:text-foreground">
        Back to sign in
      </Link>
    </form>
  );
}
