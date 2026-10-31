"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { applyApiError } from "@/lib/forms";
import { emailSchema, passwordSchema } from "@/lib/password";
import { PasswordField } from "../password-field";
import { Alert, Button, Input } from "../ui";

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: emailSchema,
  companyName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  password: passwordSchema,
});
type Values = z.infer<typeof schema>;

export function RegisterForm() {
  const { register: signUp } = useAuth();
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

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signUp({ ...values, companyName: values.companyName || undefined, phone: values.phone || undefined });
      router.replace("/dashboard");
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert>{formError}</Alert>}
      <Input label="Full name" autoComplete="name" autoFocus error={errors.name?.message} {...register("name")} />
      <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Company (optional)" autoComplete="organization" error={errors.companyName?.message} {...register("companyName")} />
        <Input label="Phone (optional)" type="tel" autoComplete="tel" error={errors.phone?.message} {...register("phone")} />
      </div>
      <PasswordField label="Password" autoComplete="new-password" watchValue={password ?? ""} error={errors.password?.message} {...register("password")} />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Create account
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
