"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/data/dialogs";
import { EmptyState, ErrorState, LoadingState, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Alert, Badge, Button, Card, CheckboxField, Input, Modal, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { applyApiError } from "@/lib/forms";
import { ApiError } from "@/lib/api";
import { useProduct, useProductMutations } from "./api";
import { ProductFormModal } from "./product-form";
import { moneyText } from "./schema";
import type { Product, ProductVariant } from "./types";

export function ProductDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <ProductDetail id={id} />;
}

function ProductDetail({ id }: { id: string }) {
  const router = useRouter();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const query = useProduct(id);
  const { remove } = useProductMutations();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (query.isPending) return <LoadingState label="Loading product" />;
  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return <ErrorState message={missing ? "This product does not exist." : "Could not load this product."} onRetry={missing ? undefined : () => void query.refetch()} />;
  }
  const p = query.data;

  return (
    <>
      <Link href="/products" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Products
      </Link>
      <PageHeader
        title={p.name}
        description={`${p.type === "SERVICE" ? "Service" : "Goods"} · ${formatMoney(p.salesPrice)}`}
        actions={
          isAdmin && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
              <Button variant="secondary" onClick={() => setDeleting(true)}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            </div>
          )
        }
      />

      <Card className="mb-6 p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <Fact label="Status">{p.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</Fact>
          <Fact label="Sales price">{formatMoney(p.salesPrice)}</Fact>
          <Fact label="Cost price">{formatMoney(p.costPrice)}</Fact>
          <Fact label="Tax">{p.tax ? `${p.tax.name} (${p.tax.ratePercent}%)${p.tax.isActive ? "" : " – inactive"}` : "None"}</Fact>
        </dl>
        {p.notes && <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-sm text-muted">{p.notes}</p>}
      </Card>

      <Variants product={p} isAdmin={isAdmin} />

      <ProductFormModal open={editing} onClose={() => setEditing(false)} product={p} />
      <ConfirmDialog
        open={deleting}
        title="Delete product"
        danger
        confirmLabel="Delete"
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await remove.mutateAsync(p.id);
          toast.success("Product deleted");
          router.replace("/products");
        }}
      >
        Delete <strong>{p.name}</strong>? Products used by subscriptions, plans or templates cannot be deleted; make them inactive instead.
      </ConfirmDialog>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

// ───────── variants ─────────
function Variants({ product, isAdmin }: { product: Product; isAdmin: boolean }) {
  const { removeVariant } = useProductMutations();
  const [editing, setEditing] = useState<ProductVariant | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProductVariant | null>(null);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-semibold">Variants</h2>
          <p className="text-xs text-muted">An extra price is added to the product&apos;s sales price.</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Add variant
          </Button>
        )}
      </div>
      {product.variants.length === 0 ? (
        <EmptyState title="No variants" hint="Add variants such as size or edition when the same product comes in options." />
      ) : (
        <TableWrap>
          <table className="w-full text-sm">
            <THead>
              <tr>
                <th className={thClass}>Attribute</th>
                <th className={thClass}>Value</th>
                <th className={`${thClass} text-right`}>Extra price</th>
                <th className={thClass}>Status</th>
                {isAdmin && (
                  <th className={`${thClass} w-24`}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </THead>
            <tbody className="divide-y divide-border">
              {product.variants.map((v) => (
                <tr key={v.id}>
                  <td className={tdClass}>{v.attribute}</td>
                  <td className={`${tdClass} font-medium`}>{v.value}</td>
                  <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(v.extraPrice)}</td>
                  <td className={tdClass}>{v.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  {isAdmin && (
                    <td className={tdClass}>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" aria-label={`Edit ${v.value}`} onClick={() => setEditing(v)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Delete ${v.value}`} onClick={() => setDeleting(v)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== "new" ? "Edit variant" : "New variant"}>
        <VariantForm productId={product.id} variant={editing && editing !== "new" ? editing : undefined} onClose={() => setEditing(null)} />
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        title="Delete variant"
        danger
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await removeVariant.mutateAsync({ productId: product.id, id: deleting!.id });
          toast.success("Variant deleted");
        }}
      >
        Delete <strong>{deleting?.attribute}: {deleting?.value}</strong>? Variants used by subscriptions cannot be deleted; make them inactive instead.
      </ConfirmDialog>
    </Card>
  );
}

const variantSchema = z.object({
  attribute: z.string().trim().min(1, "Enter an attribute").max(100),
  value: z.string().trim().min(1, "Enter a value").max(100),
  extraPrice: moneyText("an extra price"),
  isActive: z.boolean(),
});
type VariantValues = z.infer<typeof variantSchema>;

function VariantForm({ productId, variant, onClose }: { productId: string; variant?: ProductVariant; onClose: () => void }) {
  const { createVariant, updateVariant } = useProductMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VariantValues>({
    resolver: zodResolver(variantSchema),
    defaultValues: { attribute: variant?.attribute ?? "", value: variant?.value ?? "", extraPrice: variant?.extraPrice ?? "0.00", isActive: variant?.isActive ?? true },
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      if (variant) await updateVariant.mutateAsync({ productId, id: variant.id, patch: v });
      else await createVariant.mutateAsync({ productId, ...v });
      toast.success(variant ? "Variant updated" : "Variant added");
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Attribute" autoFocus placeholder="Size" error={errors.attribute?.message} {...register("attribute")} />
        <Input label="Value" placeholder="Large" error={errors.value?.message} {...register("value")} />
      </div>
      <Input label="Extra price" inputMode="decimal" error={errors.extraPrice?.message} {...register("extraPrice")} />
      <CheckboxField label="Active" {...register("isActive")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {variant ? "Save changes" : "Add variant"}
        </Button>
      </div>
    </form>
  );
}
