"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Alert, Button, Input, Modal, SelectField, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { fromCents, toCents } from "@/lib/cents";
import { formatMoney, todayIso } from "@/lib/format";
import { useRecordPayment } from "./api";
import { INVOICE_ERRORS, PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "./labels";
import type { InvoiceDetail, PaymentMethod } from "./types";

export function RecordPaymentDialog({ invoice, open, onClose }: { invoice: InvoiceDetail; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <PaymentForm invoice={invoice} onClose={onClose} />
    </Modal>
  );
}

function PaymentForm({ invoice, onClose }: { invoice: InvoiceDetail; onClose: () => void }) {
  const record = useRecordPayment(invoice.id);
  // One key per opening of the dialog: a retry (timeout, double-click) is answered with the ORIGINAL payment, never a second one.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [amount, setAmount] = useState(invoice.balance);
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const cents = toCents(amount);
  const balanceCents = toCents(invoice.balance);
  const amountError = !amount.trim() ? "Enter an amount" : Number.isNaN(cents) ? "Use a number like 1250.00" : cents <= 0 ? "Must be more than zero" : cents > balanceCents ? `More than is owed (${formatMoney(invoice.balance)})` : undefined;
  const dateError = paidOn > todayIso() ? "Can't be in the future" : paidOn < invoice.issueDate ? `Can't be before the invoice was issued (${invoice.issueDate})` : undefined;
  const settles = !amountError && cents === balanceCents;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (amountError || dateError) return;
    setError(null);
    try {
      const r = await record.mutateAsync({
        idempotencyKey,
        body: {
          method,
          amount: fromCents(cents),
          // today = "now" (the server stamps the exact time); an earlier day is sent as that date
          ...(paidOn !== todayIso() && { paidAt: paidOn }),
          ...(reference.trim() && { reference: reference.trim() }),
          ...(note.trim() && { note: note.trim() }),
        },
      });
      toast.success(r.invoice.status === "PAID" ? "Payment recorded: invoice paid in full" : `Payment recorded. ${formatMoney(r.invoice.balance)} still owed`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? (INVOICE_ERRORS[err.code] ?? err.message) : "Could not reach the server. It's safe to press Record again: it won't be recorded twice.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
        <span className="text-muted">Invoice</span> <span className="font-medium">{invoice.number}</span> · <span className="text-muted">still owed</span> <span className="font-semibold tabular-nums">{formatMoney(invoice.balance)}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </SelectField>
        <Input label="Date received" type="date" min={invoice.issueDate} max={todayIso()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} error={dateError} />
      </div>

      <Input
        label="Amount"
        inputMode="decimal"
        autoFocus
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={amountError}
        hint={
          <span>
            {settles ? "This settles the invoice." : "A partial payment leaves the rest outstanding."}{" "}
            {cents !== balanceCents && (
              <button type="button" className="text-primary hover:underline" onClick={() => setAmount(invoice.balance)}>
                Use full balance
              </button>
            )}
          </span>
        }
      />
      <Input label="Reference (optional)" placeholder="Bank reference, cheque number…" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
      <Textarea label="Note (optional)" hint="Only staff can see this." value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={record.isPending} disabled={!!amountError || !!dateError}>
          Record {amountError ? "" : formatMoney(fromCents(cents))}
        </Button>
      </div>
    </form>
  );
}
