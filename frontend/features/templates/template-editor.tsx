"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ErrorState, LoadingState } from "@/components/data/list-parts";
import { Alert, Badge, Button, Card, CheckboxField, Input, PageHeader, Select, SelectField, Textarea } from "@/components/ui";
import { usePlans, type Plan } from "@/features/plans/api";
import { useFormOptions } from "@/features/subscriptions/api";
import type { FormOptions } from "@/features/subscriptions/types";
import { billingCycle } from "@/features/subscriptions/labels";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { applyApiError } from "@/lib/forms";
import { useTemplate, useTemplateMutations, type Template } from "./api";

export function TemplateEditorRoute({ mode }: { mode: "new" | "edit" }) {
  const { id } = useParams<{ id?: string }>();
  return mode === "new" ? <Loaded template={undefined} /> : <EditLoader id={id!} />;
}

function EditLoader({ id }: { id: string }) {
  const query = useTemplate(id);
  if (query.isPending) return <LoadingState label="Loading template" />;
  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return <ErrorState message={missing ? "This template does not exist." : "Could not load this template."} onRetry={missing ? undefined : () => void query.refetch()} />;
  }
  return <Loaded template={query.data} />;
}

/** Waits for the product and plan lists, so the form always starts with its options present. */
function Loaded({ template }: { template: Template | undefined }) {
  const options = useFormOptions();
  const plans = usePlans({ limit: 100 });
  if (options.isPending || plans.isPending) return <LoadingState label="Loading" />;
  if (options.isError || plans.isError || !options.data || !plans.data) return <ErrorState message="Could not load products and plans." onRetry={() => { void options.refetch(); void plans.refetch(); }} />;
  return <Editor template={template} products={options.data.products} plans={plans.data.items} />;
}

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  planId: z.string().min(1, "Choose a plan"),
  validityDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, "Whole days, 1 to 365")
    .refine((v) => Number(v) >= 1 && Number(v) <= 365, "Whole days, 1 to 365"),
  notes: z.string().trim().max(1000),
  isActive: z.boolean(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1, "Choose a product"),
        variantId: z.string(),
        quantity: z
          .string()
          .trim()
          .regex(/^\d{1,7}$/, "Whole number")
          .refine((v) => Number(v) >= 1 && Number(v) <= 1_000_000, "1 to 1,000,000"),
      }),
    )
    .max(100),
});
type Values = z.infer<typeof schema>;

type ProductOption = FormOptions["products"][number];

function Editor({ template, products, plans }: { template?: Template; products: ProductOption[]; plans: Plan[] }) {
  const router = useRouter();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const { create, update } = useTemplateMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: template?.name ?? "",
      planId: template?.planId ?? "",
      validityDays: String(template?.validityDays ?? 30),
      notes: template?.notes ?? "",
      isActive: template?.isActive ?? true,
      lines: template?.lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? "", quantity: String(l.quantity) })) ?? [],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Price estimate of the draft as typed, from the catalog (the server returns the authoritative figure on save).
  const estimate = watchedLines.reduce((sum, l) => {
    const p = productById.get(l.productId);
    if (!p) return sum;
    const extra = p.variants.find((v) => v.id === l.variantId)?.extraPrice ?? "0";
    return sum + Math.round((Number(p.salesPrice) + Number(extra)) * 100) * (Number(l.quantity) || 0);
  }, 0);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const body = {
      name: v.name,
      planId: v.planId,
      validityDays: Number(v.validityDays),
      notes: v.notes || null,
      isActive: v.isActive,
      lines: v.lines.map((l) => ({ productId: l.productId, variantId: l.variantId || null, quantity: Number(l.quantity) })),
    };
    try {
      if (template) {
        await update.mutateAsync({ id: template.id, patch: body });
        toast.success("Template saved");
      } else {
        const saved = await create.mutateAsync(body);
        toast.success("Template created");
        router.replace(`/quotation-templates/${saved.id}`);
      }
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <>
      <Link href="/quotation-templates" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Quotation templates
      </Link>
      <PageHeader title={template ? template.name : "New template"} description={isAdmin ? undefined : "Only admins can change templates."} />

      {template && !template.usable && template.isActive && (
        <div className="mb-4">
          <Alert>
            <p className="font-medium">This template cannot be used right now:</p>
            <ul className="ml-4 list-disc">
              {template.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
        <fieldset disabled={!isAdmin} className="space-y-6">
          {formError && <Alert>{formError}</Alert>}
          <Card className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" autoFocus={!template} error={errors.name?.message} {...register("name")} />
              <SelectField label="Plan" error={errors.planId?.message} {...register("planId")}>
                <option value="">Choose a plan…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {billingCycle(p)} · {formatMoney(p.price)}
                    {p.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </SelectField>
              <Input label="Quotation valid for (days)" inputMode="numeric" error={errors.validityDays?.message} {...register("validityDays")} />
            </div>
            <Textarea label="Notes" error={errors.notes?.message} {...register("notes")} />
            <CheckboxField label="Active" hint="Inactive templates are hidden when creating subscriptions." {...register("isActive")} />
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Products</h2>
                <p className="text-xs text-muted">Copied onto the subscription at the product&apos;s current price.</p>
              </div>
              {isAdmin && (
                <Button type="button" size="sm" variant="secondary" onClick={() => append({ productId: "", variantId: "", quantity: "1" })}>
                  <Plus className="size-4" aria-hidden /> Add line
                </Button>
              )}
            </div>
            {fields.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">No products yet. A template without lines only fixes the plan.</p>
            ) : (
              <ul className="space-y-3">
                {fields.map((f, i) => {
                  const product = productById.get(watchedLines[i]?.productId ?? "");
                  const e = errors.lines?.[i];
                  return (
                    <li key={f.id} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_6rem_auto]">
                      <div>
                        <Controller
                          control={control}
                          name={`lines.${i}.productId`}
                          render={({ field }) => (
                            <Select
                              aria-label={`Product for line ${i + 1}`}
                              value={field.value}
                              onChange={(ev) => {
                                field.onChange(ev.target.value);
                                setValue(`lines.${i}.variantId`, "");
                              }}
                            >
                              <option value="">Choose a product…</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} · {formatMoney(p.salesPrice)}
                                </option>
                              ))}
                            </Select>
                          )}
                        />
                        {e?.productId && <p role="alert" className="mt-1 text-xs text-danger">{e.productId.message}</p>}
                      </div>
                      <Select aria-label={`Variant for line ${i + 1}`} disabled={!product || product.variants.length === 0} {...register(`lines.${i}.variantId`)}>
                        <option value="">{product && product.variants.length > 0 ? "No variant" : "No variants"}</option>
                        {product?.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.attribute}: {v.value}
                            {Number(v.extraPrice) > 0 ? ` (+${formatMoney(v.extraPrice)})` : ""}
                          </option>
                        ))}
                      </Select>
                      <div>
                        <input
                          aria-label={`Quantity for line ${i + 1}`}
                          inputMode="numeric"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm tabular-nums focus:border-ring"
                          {...register(`lines.${i}.quantity`)}
                        />
                        {e?.quantity && <p role="alert" className="mt-1 text-xs text-danger">{e.quantity.message}</p>}
                      </div>
                      {isAdmin && (
                        <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} onClick={() => remove(i)}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {fields.length > 0 && (
              <p className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted">Estimated per period, before tax and discounts</span>
                <span className="font-semibold tabular-nums">{formatMoney(estimate / 100)}</span>
              </p>
            )}
          </Card>

          {template && template.problems.length === 0 && template.isActive && (
            <p>
              <Badge tone="success">Ready to use</Badge>
            </p>
          )}

          {isAdmin && (
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => router.push("/quotation-templates")}>
                Back
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {template ? "Save changes" : "Create template"}
              </Button>
            </div>
          )}
        </fieldset>
      </form>
    </>
  );
}
