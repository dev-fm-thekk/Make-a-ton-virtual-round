"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { moneyText } from "@/features/catalog/schema";
import { Alert, Button, CheckboxField, Input, Modal, SelectField } from "@/components/ui";
import { todayIso } from "@/lib/format";
import { applyApiError } from "@/lib/forms";
import { usePlanMutations, type Plan } from "./api";

const intText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, `${label}: whole number from ${min} to ${max}`)
    .refine((v) => Number(v) >= min && Number(v) <= max, `${label}: whole number from ${min} to ${max}`);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const schema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(120),
    price: moneyText("a price"),
    billingPeriod: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    billingInterval: intText("Interval", 1, 365),
    minQuantity: intText("Minimum quantity", 1, 1_000_000),
    availableFrom: date,
    availableUntil: z.union([date, z.literal("")]),
    autoCloseOnEnd: z.boolean(),
    allowEarlyClose: z.boolean(),
    allowPause: z.boolean(),
    allowRenewal: z.boolean(),
    isActive: z.boolean(),
  })
  .refine((v) => !v.availableUntil || v.availableUntil >= v.availableFrom, { message: "Cannot be before the start date", path: ["availableUntil"] });
type Values = z.infer<typeof schema>;

export function PlanFormModal({ open, onClose, plan }: { open: boolean; onClose: () => void; plan?: Plan }) {
  return (
    <Modal open={open} onClose={onClose} title={plan ? "Edit plan" : "New plan"} wide>
      <PlanForm plan={plan} onClose={onClose} />
    </Modal>
  );
}

function PlanForm({ plan, onClose }: { plan?: Plan; onClose: () => void }) {
  const { create, update } = usePlanMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const locked = (plan?.liveSubscriptions ?? 0) > 0;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: plan?.name ?? "",
      price: plan?.price ?? "",
      billingPeriod: plan?.billingPeriod ?? "MONTHLY",
      billingInterval: String(plan?.billingInterval ?? 1),
      minQuantity: String(plan?.minQuantity ?? 1),
      availableFrom: plan?.availableFrom ?? todayIso(),
      availableUntil: plan?.availableUntil ?? "",
      autoCloseOnEnd: plan?.autoCloseOnEnd ?? false,
      allowEarlyClose: plan?.allowEarlyClose ?? false,
      allowPause: plan?.allowPause ?? false,
      allowRenewal: plan?.allowRenewal ?? true,
      isActive: plan?.isActive ?? true,
    },
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const body = { ...v, billingInterval: Number(v.billingInterval), minQuantity: Number(v.minQuantity), availableUntil: v.availableUntil || null };
    try {
      if (plan) {
        // The cycle is locked server-side while subscriptions bill on it; do not send it so a rename still works.
        const { billingPeriod: _p, billingInterval: _i, ...rest } = body;
        void _p;
        void _i;
        await update.mutateAsync({ id: plan.id, patch: locked ? rest : body });
      } else {
        await create.mutateAsync(body);
      }
      toast.success(plan ? "Plan updated" : "Plan added");
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      {locked && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          {plan!.liveSubscriptions} live {plan!.liveSubscriptions === 1 ? "subscription bills" : "subscriptions bill"} on this plan, so its billing cycle is locked. Everything else can change.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" autoFocus error={errors.name?.message} {...register("name")} />
        <Input label="Price per period" inputMode="decimal" error={errors.price?.message} {...register("price")} />
        <SelectField label="Billing period" disabled={locked} error={errors.billingPeriod?.message} {...register("billingPeriod")}>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </SelectField>
        <Input label="Bill every N periods" inputMode="numeric" disabled={locked} hint="3 with Monthly = quarterly." error={errors.billingInterval?.message} {...register("billingInterval")} />
        <Input label="Minimum quantity" inputMode="numeric" error={errors.minQuantity?.message} {...register("minQuantity")} />
        <span className="hidden sm:block" />
        <Input label="Available from" type="date" error={errors.availableFrom?.message} {...register("availableFrom")} />
        <Input label="Available until" type="date" hint="Leave empty for no end." error={errors.availableUntil?.message} {...register("availableUntil")} />
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Rules</legend>
        <CheckboxField label="Allow pausing" hint="Subscribers can pause billing." {...register("allowPause")} />
        <CheckboxField label="Allow early close" hint="Subscribers can close before the end date." {...register("allowEarlyClose")} />
        <CheckboxField label="Allow renewal" hint="Closed subscriptions can be renewed." {...register("allowRenewal")} />
        <CheckboxField label="Close automatically at end" hint="The subscription closes when its end date passes." {...register("autoCloseOnEnd")} />
        <CheckboxField label="Active" hint="Inactive plans cannot be chosen for new subscriptions." {...register("isActive")} />
      </fieldset>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {plan ? "Save changes" : "Add plan"}
        </Button>
      </div>
    </form>
  );
}
