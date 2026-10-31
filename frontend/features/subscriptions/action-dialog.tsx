"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, Button, Input, Modal, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { addDaysIso, formatDate } from "@/lib/format";
import { useTransition, subscriptionKeys } from "./api";
import { ACTIONS, ERROR_HINTS } from "./labels";
import type { SubscriptionAction, SubscriptionDetail } from "./types";

/**
 * One dialog for every lifecycle step. It shows what will happen, collects the extra input some steps need
 * (a reason to close, a new expiry to renew), and sends the version it was looking at so a concurrent change is detected.
 */
export function ActionDialog({ subscription, action, onClose }: { subscription: SubscriptionDetail; action: SubscriptionAction | null; onClose: () => void }) {
  return (
    <Modal open={action !== null} onClose={onClose} title={action ? ACTIONS[action].label : ""}>
      {action && <ActionBody subscription={subscription} action={action} onClose={onClose} />}
    </Modal>
  );
}

function ActionBody({ subscription, action, onClose }: { subscription: SubscriptionDetail; action: SubscriptionAction; onClose: () => void }) {
  const meta = ACTIONS[action];
  const transition = useTransition(subscription.id);
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);

  const minExpiry = subscription.expiryDate ? addDaysIso(subscription.expiryDate, 1) : undefined;
  const missing = (meta.needs === "reason" && !reason.trim()) || (meta.needs === "expiry" && (!expiry || (minExpiry !== undefined && expiry < minExpiry)));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await transition.mutateAsync({
        action,
        version: subscription.version,
        ...(meta.needs === "reason" && { reason: reason.trim() }),
        ...(meta.needs === "expiry" && { expiryDate: expiry }),
      });
      toast.success(meta.done);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STALE_VERSION") {
        // Show the latest state; the user decides again with current information.
        void qc.invalidateQueries({ queryKey: subscriptionKeys.detail(subscription.id) });
        toast.warning(ERROR_HINTS.STALE_VERSION);
        onClose();
        return;
      }
      setError(err instanceof ApiError ? (ERROR_HINTS[err.code] ?? err.message) : "Something went wrong. Try again.");
    }
  }

  return (
    <form onSubmit={run} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-muted">{meta.description}</p>

      {action === "activate" && subscription.nextBillingDate === null && <p className="text-sm">Billing starts from the next scheduled date after activation.</p>}

      {meta.needs === "reason" && <Textarea label="Reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer moved to another provider" maxLength={500} />}

      {meta.needs === "expiry" && (
        <Input
          label="New expiry date"
          type="date"
          autoFocus
          min={minExpiry}
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          hint={subscription.expiryDate ? `Currently ${formatDate(subscription.expiryDate)}. Pick a later date.` : undefined}
        />
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant={meta.variant === "danger" ? "danger" : "primary"} loading={transition.isPending} disabled={missing}>
          {meta.label}
        </Button>
      </div>
    </form>
  );
}
