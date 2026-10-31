"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/data/dialogs";
import { EmptyState, ErrorState, LoadingState, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Alert, Badge, Button, Card, CheckboxField, Input, Modal, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { applyApiError } from "@/lib/forms";
import { useTaxes, useTaxMutations } from "./api";
import { percentText } from "./schema";
import type { Tax } from "./types";

const schema = z.object({ name: z.string().trim().min(1, "Enter a name").max(100), ratePercent: percentText, isActive: z.boolean() });
type Values = z.infer<typeof schema>;

export function TaxesPage() {
  const isAdmin = useAuth().user?.role === "ADMIN";
  const query = useTaxes();
  const { remove } = useTaxMutations();
  const [editing, setEditing] = useState<Tax | "new" | null>(null);
  const [deleting, setDeleting] = useState<Tax | null>(null);
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Taxes"
        description="Rates applied to products on quotations and invoices."
        actions={
          isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> New tax
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading taxes" />
        ) : query.isError ? (
          <ErrorState message="Could not load taxes." onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No taxes yet"
            hint="Add GST or VAT rates, then attach them to products."
            action={isAdmin && <Button size="sm" onClick={() => setEditing("new")}>New tax</Button>}
          />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Name</th>
                  <th className={`${thClass} text-right`}>Rate</th>
                  <th className={thClass}>Status</th>
                  {isAdmin && (
                    <th className={`${thClass} w-24`}>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {items.map((t) => (
                  <tr key={t.id}>
                    <td className={`${tdClass} font-medium`}>{t.name}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{t.ratePercent}%</td>
                    <td className={tdClass}>{t.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    {isAdmin && (
                      <td className={tdClass}>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
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
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== "new" ? "Edit tax" : "New tax"}>
        <TaxForm tax={editing && editing !== "new" ? editing : undefined} onClose={() => setEditing(null)} />
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        title="Delete tax"
        danger
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          toast.success("Tax deleted");
        }}
      >
        Delete <strong>{deleting?.name}</strong>? If products still use it, deactivate it instead.
      </ConfirmDialog>
    </>
  );
}

function TaxForm({ tax, onClose }: { tax?: Tax; onClose: () => void }) {
  const { create, update } = useTaxMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: tax?.name ?? "", ratePercent: tax?.ratePercent ?? "", isActive: tax?.isActive ?? true } });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      if (tax) await update.mutateAsync({ id: tax.id, patch: v });
      else await create.mutateAsync(v);
      toast.success(tax ? "Tax updated" : "Tax added");
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <Input label="Name" autoFocus placeholder="GST 18%" error={errors.name?.message} {...register("name")} />
      <Input label="Rate (%)" inputMode="decimal" error={errors.ratePercent?.message} {...register("ratePercent")} />
      <CheckboxField label="Active" hint="Inactive taxes cannot be assigned to products." {...register("isActive")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {tax ? "Save changes" : "Add tax"}
        </Button>
      </div>
    </form>
  );
}
