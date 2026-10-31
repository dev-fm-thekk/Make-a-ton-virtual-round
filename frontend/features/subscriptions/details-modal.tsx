"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, Button, Input, Modal, SelectField, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useFormOptions, useUpdateSubscription, subscriptionKeys } from "./api";
import { ERROR_HINTS } from "./labels";
import type { SubscriptionDetail } from "./types";

/** Edit header fields (payment terms, dates, notes) while the subscription is still a draft or quotation. */
export function DetailsModal({ subscription, open, onClose }: { subscription: SubscriptionDetail; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Edit details">
      <DetailsForm subscription={subscription} onClose={onClose} />
    </Modal>
  );
}

function DetailsForm({ subscription, onClose }: { subscription: SubscriptionDetail; onClose: () => void }) {
  const options = useFormOptions();
  const update = useUpdateSubscription(subscription.id);
  const qc = useQueryClient();
  const [termId, setTermId] = useState(subscription.paymentTerm.id);
  const [start, setStart] = useState(subscription.startDate);
  const [expiry, setExpiry] = useState(subscription.expiryDate ?? "");
  const [notes, setNotes] = useState(subscription.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const invalidRange = !!expiry && !!start && expiry < start;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({
        version: subscription.version,
        paymentTermId: termId,
        startDate: start,
        expiryDate: expiry || null,
        notes: notes.trim() || null,
      });
      toast.success("Details saved");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STALE_VERSION") {
        void qc.invalidateQueries({ queryKey: subscriptionKeys.detail(subscription.id) });
        toast.warning(ERROR_HINTS.STALE_VERSION);
        onClose();
        return;
      }
      setError(err instanceof ApiError ? (ERROR_HINTS[err.code] ?? err.message) : "Could not save. Try again.");
    }
  }

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <SelectField label="Payment terms" value={termId} onChange={(e) => setTermId(e.target.value)}>
        {(options.data?.paymentTerms ?? [{ id: subscription.paymentTerm.id, name: subscription.paymentTerm.name }]).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Start date" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <Input label="Expiry date" type="date" min={start} value={expiry} onChange={(e) => setExpiry(e.target.value)} error={invalidRange ? "Must be on or after the start date" : undefined} />
      </div>
      <Textarea label="Internal notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={update.isPending} disabled={invalidRange || !start}>
          Save
        </Button>
      </div>
    </form>
  );
}
