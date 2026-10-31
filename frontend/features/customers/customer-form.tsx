"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, Button, Input, Modal, Textarea } from "@/components/ui";
import { applyApiError } from "@/lib/forms";
import { emailSchema } from "@/lib/password";
import { useCreateCustomer, useOwnProfile, useUpdateCustomer, useUpdateOwnProfile } from "./api";
import type { Address, Customer, CustomerInput, CustomerDetail } from "./types";

// ───────── schema & mapping ─────────
const text = (max: number) => z.string().trim().max(max);
const addressSchema = z.object({ line1: text(200), line2: text(200), city: text(100), state: text(100), postalCode: text(20), country: text(100) });
type AddressValues = z.infer<typeof addressSchema>;

/** The API accepts an address only when it is complete: all-or-nothing. */
function requireCompleteAddress(v: { address: AddressValues }, ctx: z.RefinementCtx) {
  const a = v.address;
  if (!Object.values(a).some(Boolean)) return;
  for (const f of ["line1", "city", "postalCode", "country"] as const) {
    if (!a[f]) ctx.addIssue({ code: "custom", path: ["address", f], message: "Required when adding an address" });
  }
}

const staffSchema = z
  .object({
    name: text(120).min(1, "Enter a name"),
    email: emailSchema,
    companyName: text(160),
    phone: text(40),
    taxId: text(40),
    notes: text(2000),
    address: addressSchema,
  })
  .superRefine(requireCompleteAddress);
type StaffValues = z.infer<typeof staffSchema>;

const ownSchema = z
  .object({ name: staffSchema.shape.name, companyName: text(160), phone: text(40), taxId: text(40), address: addressSchema })
  .superRefine(requireCompleteAddress);
type OwnValues = z.infer<typeof ownSchema>;

const blankAddress: AddressValues = { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" };
const addressValues = (a: Address | null | undefined): AddressValues => ({ ...blankAddress, ...(a ?? {}) });

function toAddress(a: AddressValues): Address | null {
  if (!Object.values(a).some(Boolean)) return null;
  return { line1: a.line1, city: a.city, postalCode: a.postalCode, country: a.country, ...(a.line2 && { line2: a.line2 }), ...(a.state && { state: a.state }) };
}

/** Empty string → null so clearing a field in the form actually clears it on the server. */
const nullable = (s: string) => s || null;

// ───────── shared field group ─────────
// Reads the surrounding <FormProvider>; both forms below nest the slice under `address`.
function AddressFields() {
  const {
    register,
    formState: { errors: all },
  } = useFormContext<{ address: AddressValues }>();
  const errors = all.address;
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1 text-sm font-medium">Billing address</legend>
      <Input label="Address line 1" autoComplete="address-line1" error={errors?.line1?.message} {...register("address.line1")} />
      <Input label="Address line 2" autoComplete="address-line2" error={errors?.line2?.message} {...register("address.line2")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="City" autoComplete="address-level2" error={errors?.city?.message} {...register("address.city")} />
        <Input label="State / region" autoComplete="address-level1" error={errors?.state?.message} {...register("address.state")} />
        <Input label="Postal code" autoComplete="postal-code" error={errors?.postalCode?.message} {...register("address.postalCode")} />
        <Input label="Country" autoComplete="country-name" error={errors?.country?.message} {...register("address.country")} />
      </div>
    </fieldset>
  );
}

// ───────── staff: create / edit a customer ─────────
export function CustomerFormModal({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer?: Customer; onSaved?: (c: Customer) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={customer ? "Edit customer" : "New customer"} wide>
      {/* children mount only while open, so the form always starts from the current customer */}
      <StaffForm customer={customer} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function StaffForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const create = useCreateCustomer();
  const update = useUpdateCustomer(customer?.id ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<StaffValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      name: customer?.name ?? "",
      email: customer?.email ?? "",
      companyName: customer?.companyName ?? "",
      phone: customer?.phone ?? "",
      taxId: customer?.taxId ?? "",
      notes: customer?.notes ?? "",
      address: addressValues(customer?.billingAddress),
    },
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const address = toAddress(v.address);
    try {
      if (customer) {
        const saved: CustomerDetail = await update.mutateAsync({
          name: v.name,
          email: v.email,
          companyName: nullable(v.companyName),
          phone: nullable(v.phone),
          taxId: nullable(v.taxId),
          notes: nullable(v.notes),
          billingAddress: address,
        });
        toast.success("Customer updated");
        onSaved?.(saved);
      } else {
        const input: CustomerInput = {
          name: v.name,
          email: v.email,
          ...(v.companyName && { companyName: v.companyName }),
          ...(v.phone && { phone: v.phone }),
          ...(v.taxId && { taxId: v.taxId }),
          ...(v.notes && { notes: v.notes }),
          ...(address && { billingAddress: address }),
        };
        const saved = await create.mutateAsync(input);
        toast.success(`${saved.name} added`);
        onSaved?.(saved);
      }
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <FormProvider {...form}>
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert>{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Contact name" autoFocus error={errors.name?.message} {...register("name")} />
        <Input label="Email" type="email" error={errors.email?.message} {...register("email")} />
        <Input label="Company" error={errors.companyName?.message} {...register("companyName")} />
        <Input label="Phone" type="tel" error={errors.phone?.message} {...register("phone")} />
        <Input label="Tax ID (GST/VAT)" error={errors.taxId?.message} {...register("taxId")} />
      </div>
      <AddressFields />
      <Textarea label="Internal notes" hint="Only staff can see these." error={errors.notes?.message} {...register("notes")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {customer ? "Save changes" : "Add customer"}
        </Button>
      </div>
    </form>
    </FormProvider>
  );
}

// ───────── customer: edit own billing details (Account page) ─────────
export function OwnProfileForm() {
  const { data: profile, isPending, isError } = useOwnProfile(true);
  if (isPending) return <p className="text-sm text-muted">Loading your details…</p>;
  if (isError || !profile) return <Alert>We couldn&apos;t load your billing details.</Alert>;
  return <OwnProfileInner profile={profile} />;
}

const ownDefaults = (p: Omit<Customer, "notes">): OwnValues => ({
  name: p.name,
  companyName: p.companyName ?? "",
  phone: p.phone ?? "",
  taxId: p.taxId ?? "",
  address: addressValues(p.billingAddress),
});

function OwnProfileInner({ profile }: { profile: Omit<Customer, "notes"> }) {
  const update = useUpdateOwnProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<OwnValues>({ resolver: zodResolver(ownSchema), defaultValues: ownDefaults(profile) });
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const saved = await update.mutateAsync({
        name: v.name,
        companyName: nullable(v.companyName),
        phone: nullable(v.phone),
        taxId: nullable(v.taxId),
        billingAddress: toAddress(v.address),
      });
      reset(ownDefaults(saved));
      toast.success("Details saved");
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <FormProvider {...form}>
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {formError && <Alert>{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" autoComplete="name" error={errors.name?.message} {...register("name")} />
        <Input label="Company" autoComplete="organization" error={errors.companyName?.message} {...register("companyName")} />
        <Input label="Phone" type="tel" autoComplete="tel" error={errors.phone?.message} {...register("phone")} />
        <Input label="Tax ID (GST/VAT)" error={errors.taxId?.message} {...register("taxId")} />
      </div>
      <AddressFields />
      <p className="text-xs text-muted">These details appear on your invoices.</p>
      <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
        Save details
      </Button>
    </form>
    </FormProvider>
  );
}
