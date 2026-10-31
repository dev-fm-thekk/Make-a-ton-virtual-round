"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { post } from "@/lib/api";
import { applyApiError } from "@/lib/forms";
import { emailSchema, passwordSchema } from "@/lib/password";
import { PasswordField } from "../password-field";
import { Alert, Button, Input, Modal } from "../ui";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  email: emailSchema,
  password: passwordSchema,
});
type Values = z.infer<typeof schema>;

export function CreateStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add staff member">
      {/* Modal only mounts its children while open → the form starts fresh every time */}
      <StaffForm onClose={onClose} />
    </Modal>
  );
}

function StaffForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
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
      await post("/users/staff", values);
      toast.success(`${values.name} added as staff`);
      void qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Input label="Full name" autoFocus error={errors.name?.message} {...register("name")} />
        <Input label="Work email" type="email" error={errors.email?.message} {...register("email")} />
        <PasswordField label="Temporary password" autoComplete="new-password" watchValue={password ?? ""} error={errors.password?.message} {...register("password")} />
        <p className="text-xs text-muted">Share this password securely; they can change it from their account page.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Add staff
          </Button>
        </div>
      </form>
  );
}
