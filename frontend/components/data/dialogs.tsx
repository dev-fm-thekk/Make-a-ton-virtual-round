"use client";

import { useState, type ReactNode } from "react";
import { Alert, Button, Modal } from "../ui";

/**
 * Replaces window.confirm: accessible, themed, and can hold an async action with its own error state.
 * `onConfirm` may throw; the message is shown inline and the dialog stays open.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <ConfirmBody confirmLabel={confirmLabel} danger={danger} onConfirm={onConfirm} onClose={onClose}>
        {children}
      </ConfirmBody>
    </Modal>
  );
}

function ConfirmBody({ children, confirmLabel, danger, onConfirm, onClose }: { children?: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {children && <div className="text-sm text-muted">{children}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={() => void run()} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
