"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, Button, CheckboxField, Input, Modal, SelectField } from "@/components/ui";
import { moneyText } from "@/features/catalog/schema";
import { useFormOptions } from "@/features/subscriptions/api";
import { todayIso } from "@/lib/format";
import { applyApiError } from "@/lib/forms";
import { useDiscountMutations, type Discount } from "./api";

const optionalInt = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,10}$/.test(v) && Number(v) >= 1 && Number(v) <= max), `${label}: whole number from 1 to ${max.toLocaleString("en-IN")}`);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const schema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(120),
    type: z.enum(["FIXED", "PERCENTAGE"]),
    value: moneyText("a value").refine((v) => Number(v) > 0, "Must be more than 0"),
    scope: z.enum(["PRODUCT", "SUBSCRIPTION"]),
    minPurchaseAmount: z.union([moneyText("an amount"), z.literal("")]),
    minQuantity: optionalInt("Minimum quantity", 1_000_000),
    startDate: date,
    endDate: z.union([date, z.literal("")]),
    usageLimit: optionalInt("Usage limit", 1_000_000_000),
    isActive: z.boolean(),
    productIds: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if (v.type === "PERCENTAGE" && Number(v.value) > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "A percentage cannot be more than 100" });
    if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Cannot be before the start date" });
    if (v.scope === "PRODUCT" && v.isActive && v.productIds.length === 0) ctx.addIssue({ code: "custom", path: ["productIds"], message: "Choose at least one product, or save it as inactive" });
  });
type Values = z.infer<typeof schema>;

export function DiscountFormModal({ open, onClose, discount, onSaved }: { open: boolean; onClose: () => void; discount?: Discount; onSaved?: (d: Discount) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={discount ? "Edit discount" : "New discount"} wide>
      <DiscountForm discount={discount} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function DiscountForm({ discount, onClose, onSaved }: { discount?: Discount; onClose: () => void; onSaved?: (d: Discount) => void }) {
  const { create, update } = useDiscountMutations();
  const options = useFormOptions();
  const [formError, setFormError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: discount?.name ?? "",
      type: discount?.type ?? "PERCENTAGE",
      value: discount?.value ?? "",
      scope: discount?.scope ?? "PRODUCT",
      minPurchaseAmount: discount?.minPurchaseAmount ?? "",
      minQuantity: discount?.minQuantity?.toString() ?? "",
      startDate: discount?.startDate ?? todayIso(),
      endDate: discount?.endDate ?? "",
      usageLimit: discount?.usageLimit?.toString() ?? "",
      isActive: discount?.isActive ?? true,
      productIds: discount?.products.map((p) => p.id) ?? [],
    },
  });
  const scope = useWatch({ control, name: "scope" });
  const type = useWatch({ control, name: "type" });

  // Active products to pick from, plus any already-selected products that have since been deactivated.
  const known = new Map((options.data?.products ?? []).map((p) => [p.id, p.name]));
  for (const p of discount?.products ?? []) if (!known.has(p.id)) known.set(p.id, `${p.name} (inactive)`);
  const choices = [...known].map(([id, name]) => ({ id, name })).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const body = {
      name: v.name,
      type: v.type,
      value: v.value,
      scope: v.scope,
      minPurchaseAmount: v.minPurchaseAmount || null,
      minQuantity: v.minQuantity ? Number(v.minQuantity) : null,
      startDate: v.startDate,
      endDate: v.endDate || null,
      usageLimit: v.usageLimit ? Number(v.usageLimit) : null,
      isActive: v.isActive,
      productIds: v.scope === "PRODUCT" ? v.productIds : [],
    };
    try {
      const saved = discount ? await update.mutateAsync({ id: discount.id, patch: body }) : await create.mutateAsync(body);
      toast.success(discount ? "Discount updated" : "Discount added");
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" autoFocus error={errors.name?.message} {...register("name")} />
        <SelectField label="Applies to" error={errors.scope?.message} {...register("scope")}>
          <option value="PRODUCT">Specific products</option>
          <option value="SUBSCRIPTION">Whole subscription (attached per subscription)</option>
        </SelectField>
        <SelectField label="Type" error={errors.type?.message} {...register("type")}>
          <option value="PERCENTAGE">Percentage</option>
          <option value="FIXED">Fixed amount</option>
        </SelectField>
        <Input label={type === "PERCENTAGE" ? "Percentage off" : "Amount off"} inputMode="decimal" error={errors.value?.message} {...register("value")} />
        <Input label="Starts" type="date" error={errors.startDate?.message} {...register("startDate")} />
        <Input label="Ends" type="date" hint="Leave empty for no end." error={errors.endDate?.message} {...register("endDate")} />
        <Input label="Minimum purchase" inputMode="decimal" hint="Optional. Applies only above this amount." error={errors.minPurchaseAmount?.message} {...register("minPurchaseAmount")} />
        <Input label="Minimum quantity" inputMode="numeric" hint="Optional." error={errors.minQuantity?.message} {...register("minQuantity")} />
        <Input label="Usage limit" inputMode="numeric" hint="Total invoices that may use it. Empty = unlimited." error={errors.usageLimit?.message} {...register("usageLimit")} />
      </div>

      {scope === "PRODUCT" && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Products</legend>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter products"
            placeholder="Filter products"
            className="mb-2 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-ring"
          />
          <Controller
            control={control}
            name="productIds"
            render={({ field }) => (
              <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {options.isPending ? (
                  <p className="p-3 text-sm text-muted">Loading products…</p>
                ) : choices.length === 0 ? (
                  <p className="p-3 text-sm text-muted">{known.size === 0 ? "No active products yet." : "No products match."}</p>
                ) : (
                  choices.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2/60">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={field.value.includes(p.id)}
                        onChange={(e) => field.onChange(e.target.checked ? [...field.value, p.id] : field.value.filter((id) => id !== p.id))}
                      />
                      {p.name}
                    </label>
                  ))
                )}
              </div>
            )}
          />
          {errors.productIds?.message && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {errors.productIds.message}
            </p>
          )}
        </fieldset>
      )}

      <CheckboxField label="Active" hint="Inactive discounts are never applied." {...register("isActive")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {discount ? "Save changes" : "Add discount"}
        </Button>
      </div>
    </form>
  );
}
