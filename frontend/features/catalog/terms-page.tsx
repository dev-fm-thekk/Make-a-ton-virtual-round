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
import { plural } from "@/lib/format";
import { applyApiError } from "@/lib/forms";
import { usePaymentTermMutations, usePaymentTerms } from "./api";
import type { PaymentTerm } from "./types";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  dueDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, "Whole days, 0 to 365")
    .refine((v) => Number(v) <= 365, "Whole days, 0 to 365"),
  isDefault: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function PaymentTermsPage() {
  const isAdmin = useAuth().user?.role === "ADMIN";
  const query = usePaymentTerms();
  const { remove } = usePaymentTermMutations();
  const [editing, setEditing] = useState<PaymentTerm | "new" | null>(null);
  const [deleting, setDeleting] = useState<PaymentTerm | null>(null);
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Payment terms"
        description="How long customers have to pay an invoice after it is issued."
        actions={
          isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> New term
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading payment terms" />
        ) : query.isError ? (
          <ErrorState message="Could not load payment terms." onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="No payment terms yet" action={isAdmin && <Button size="sm" onClick={() => setEditing("new")}>New term</Button>} />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Name</th>
                  <th className={thClass}>Due</th>
                  <th className={thClass}>Default</th>
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
                    <td className={tdClass}>{t.dueDays === 0 ? "On receipt" : `${plural(t.dueDays, "day")} after issue`}</td>
                    <td className={tdClass}>{t.isDefault && <Badge tone="primary">Default</Badge>}</td>
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== "new" ? "Edit payment term" : "New payment term"}>
        <TermForm term={editing && editing !== "new" ? editing : undefined} onClose={() => setEditing(null)} />
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        title="Delete payment term"
        danger
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          toast.success("Payment term deleted");
        }}
      >
        Delete <strong>{deleting?.name}</strong>? Terms used by subscriptions or invoices cannot be deleted.
      </ConfirmDialog>
    </>
  );
}

function TermForm({ term, onClose }: { term?: PaymentTerm; onClose: () => void }) {
  const { create, update } = usePaymentTermMutations();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: term?.name ?? "", dueDays: String(term?.dueDays ?? 15), isDefault: term?.isDefault ?? false } });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const body = { name: v.name, dueDays: Number(v.dueDays), isDefault: v.isDefault };
    try {
      if (term) await update.mutateAsync({ id: term.id, patch: body });
      else await create.mutateAsync(body);
      toast.success(term ? "Payment term updated" : "Payment term added");
      onClose();
    } catch (err) {
      setFormError(applyApiError(err, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <Input label="Name" autoFocus placeholder="Net 30" error={errors.name?.message} {...register("name")} />
      <Input label="Due after (days)" inputMode="numeric" hint="0 means due on receipt." error={errors.dueDays?.message} {...register("dueDays")} />
      <CheckboxField label="Default" hint="Pre-selected on new subscriptions. Only one term can be the default." {...register("isDefault")} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {term ? "Save changes" : "Add term"}
        </Button>
      </div>
    </form>
  );
}
