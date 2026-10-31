"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, Button, CheckboxField, Input, Modal, SelectField, Textarea } from "@/components/ui";
import { applyApiError } from "@/lib/forms";
import { useProductMutations, useTaxes } from "./api";
import { moneyText } from "./schema";
import type { Product } from "./types";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  type: z.enum(["SERVICE", "GOODS"]),
  salesPrice: moneyText("a sales price"),
  costPrice: moneyText("a cost price"),
  taxId: z.string(),
  notes: z.string().trim().max(1000),
  isActive: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function ProductFormModal({ open, onClose, product, onSaved }: { open: boolean; onClose: () => void; product?: Product; onSaved?: (p: Product) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={product ? "Edit product" : "New product"} wide>
      <ProductForm product={product} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved?: (p: Product) => void }) {
  const { create, update } = useProductMutations();
  const taxes = useTaxes({ isActive: "true" });
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: product?.name ?? "",
      type: product?.type ?? "SERVICE",
      salesPrice: product?.salesPrice ?? "",
      costPrice: product?.costPrice ?? "0.00",
      taxId: product?.taxId ?? "",
      notes: product?.notes ?? "",
      isActive: product?.isActive ?? true,
    },
  });

  // A tax that has since been deactivated is still shown for the product that carries it.
  const options = taxes.data?.items ?? [];
  const current = product?.tax && !options.some((t) => t.id === product.tax!.id) ? product.tax : null;

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const saved = product
        ? await update.mutateAsync({ id: product.id, patch: { ...v, taxId: v.taxId || null, notes: v.notes || null } })
        : await create.mutateAsync({ ...v, taxId: v.taxId || null, notes: v.notes || undefined });
      toast.success(product ? "Product updated" : `${saved.name} added`);
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
        <SelectField label="Type" error={errors.type?.message} {...register("type")}>
          <option value="SERVICE">Service</option>
          <option value="GOODS">Goods</option>
        </SelectField>
        <Input label="Sales price" inputMode="decimal" error={errors.salesPrice?.message} {...register("salesPrice")} />
        <Input label="Cost price" inputMode="decimal" error={errors.costPrice?.message} {...register("costPrice")} />
        <SelectField label="Tax" hint={taxes.data && options.length === 0 && !current ? "No active taxes yet. Add one under Taxes." : undefined} error={errors.taxId?.message} {...register("taxId")}>
          <option value="">No tax</option>
          {current && <option value={current.id}>{current.name} (inactive)</option>}
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.ratePercent}%)
            </option>
          ))}
        </SelectField>
      </div>
      <Textarea label="Notes" error={errors.notes?.message} {...register("notes")} />
      <CheckboxField label="Active" hint="Inactive products cannot be added to new subscriptions." {...register("isActive")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {product ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  );
}
