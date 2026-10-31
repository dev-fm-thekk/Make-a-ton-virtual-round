"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/data/dialogs";
import { Alert, Button, Card, Modal, SelectField } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/forms";
import { useDiscountMutations, useDiscounts, useSubscriptionDiscounts, type Discount } from "./api";
import { DiscountStatusBadge, formatDiscountValue } from "./labels";

/**
 * Staff-only card on a subscription: the discounts attached to the whole subscription. Product-scoped discounts are not
 * listed here because they apply on their own to matching lines. Only admins can attach or detach.
 */
export function SubscriptionDiscounts({ subscriptionId, closed }: { subscriptionId: string; closed: boolean }) {
  const isAdmin = useAuth().user?.role === "ADMIN";
  const query = useSubscriptionDiscounts(subscriptionId);
  const { detachFromSubscription } = useDiscountMutations();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Discount | null>(null);
  const items = query.data ?? [];

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Discounts</h2>
        {isAdmin && !closed && (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden /> Attach
          </Button>
        )}
      </div>
      {query.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : query.isError ? (
        <p className="text-sm text-danger">Could not load discounts.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No subscription-wide discounts. Product discounts still apply to matching lines.</p>
      ) : (
        <ul className="space-y-3">
          {items.map(({ discount: d }) => (
            <li key={d.id} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <Link href={`/discounts/${d.id}`} className="font-medium text-primary hover:underline">
                  {d.name}
                </Link>
                <p className="mt-0.5 flex items-center gap-2 text-muted">
                  {formatDiscountValue(d)} off <DiscountStatusBadge status={d.status} />
                </p>
              </div>
              {isAdmin && (
                <button type="button" aria-label={`Detach ${d.name}`} onClick={() => setRemoving(d)} className="rounded p-1 text-muted hover:bg-surface-2">
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Attach a discount">
        <AttachForm subscriptionId={subscriptionId} attachedIds={items.map((i) => i.discount.id)} onClose={() => setAdding(false)} />
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title="Detach discount"
        confirmLabel="Detach"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await detachFromSubscription.mutateAsync({ id: removing!.id, subscriptionId });
          toast.success("Discount detached");
        }}
      >
        Stop applying <strong>{removing?.name}</strong> to this subscription&apos;s future invoices?
      </ConfirmDialog>
    </Card>
  );
}

function AttachForm({ subscriptionId, attachedIds, onClose }: { subscriptionId: string; attachedIds: string[]; onClose: () => void }) {
  const query = useDiscounts({ scope: "SUBSCRIPTION", limit: 100 });
  const { attachToSubscription } = useDiscountMutations();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = (query.data?.items ?? []).filter((d) => !attachedIds.includes(d.id) && d.status !== "expired");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await attachToSubscription.mutateAsync({ id: choice, subscriptionId });
      toast.success("Discount attached");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <SelectField
        label="Discount"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        hint={query.isSuccess && choices.length === 0 ? "No other subscription-wide discounts available. Create one under Discounts." : undefined}
      >
        <option value="">{query.isPending ? "Loading…" : "Choose a discount…"}</option>
        {choices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · {formatDiscountValue(d)} off
          </option>
        ))}
      </SelectField>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={!choice} loading={busy}>
          Attach
        </Button>
      </div>
    </div>
  );
}
