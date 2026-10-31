"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/data/list-parts";
import { Alert, Badge, Button, Card, Input, PageHeader, SelectField, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { useCustomer } from "../customers/api";
import { CustomerPicker, type PickedCustomer } from "../customers/customer-picker";
import { useCreateSubscription, useFormOptions } from "./api";
import { billingCycle, ERROR_HINTS } from "./labels";
import { LinesEditor } from "./lines-editor";
import { blankLine, lineProblem, newKey, toPayload } from "./preview";
import type { DraftLine, FormOptions } from "./types";

type Errors = Partial<Record<"customer" | "plan" | "startDate" | "expiryDate" | "lines" | "form", string>>;

export function SubscriptionForm() {
  const options = useFormOptions();
  const prefillId = useSearchParams().get("customerId");
  const prefill = useCustomer(prefillId ?? "");

  if (options.isPending) return <LoadingState label="Loading catalog" />;
  if (options.isError) return <ErrorState message="Could not load plans and products." onRetry={() => void options.refetch()} />;
  if (prefillId && prefill.isPending) return <LoadingState />;

  const prefilled: PickedCustomer | null = prefill.data ? { id: prefill.data.id, name: prefill.data.name, companyName: prefill.data.companyName } : null;
  return <FormBody options={options.data} initialCustomer={prefilled} />;
}

function FormBody({ options, initialCustomer }: { options: FormOptions; initialCustomer: PickedCustomer | null }) {
  const router = useRouter();
  const create = useCreateSubscription();

  const defaultTerm = options.paymentTerms.find((t) => t.isDefault) ?? options.paymentTerms[0];
  const [customer, setCustomer] = useState<PickedCustomer | null>(initialCustomer);
  const [templateId, setTemplateId] = useState("");
  const [planId, setPlanId] = useState("");
  const [termId, setTermId] = useState(defaultTerm?.id ?? "");
  const [startDate, setStartDate] = useState(todayIso());
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  const template = options.templates.find((t) => t.id === templateId);
  const plan = options.plans.find((p) => p.id === (template?.planId ?? planId));

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = options.templates.find((x) => x.id === id);
    if (!t) return;
    // A template carries its own plan and product lines; start from them.
    setPlanId(t.planId);
    setLines(t.lines.map((l) => ({ key: newKey(), productId: l.productId, variantId: l.variantId ?? "", quantity: l.quantity, unitPrice: "", taxChoice: "" })));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (!customer) e.customer = "Choose a customer";
    if (!plan) e.plan = "Choose a plan";
    if (!startDate) e.startDate = "Choose a start date";
    if (expiryDate && startDate && expiryDate < startDate) e.expiryDate = "Expiry must be on or after the start date";
    if (lines.length === 0) e.lines = "Add at least one product line";
    else if (lines.some((l) => lineProblem(l))) e.lines = "Fix the highlighted lines";
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitted(true);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    try {
      const { subscription } = await create.mutateAsync({
        customerId: customer!.id,
        planId: plan!.id,
        ...(templateId && { quotationTemplateId: templateId }),
        ...(termId && { paymentTermId: termId }),
        startDate,
        ...(expiryDate && { expiryDate }),
        ...(notes.trim() && { notes: notes.trim() }),
        lines: lines.map(toPayload),
      });
      toast.success(`${subscription.number} created`);
      router.push(`/subscriptions/${subscription.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? (ERROR_HINTS[err.code] ?? err.message) : "Could not create the subscription. Try again.";
      setErrors({ form: msg });
    }
  }

  return (
    <>
      <Link href="/subscriptions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Subscriptions
      </Link>
      <PageHeader title="New subscription" description="It starts as a draft. You can keep editing until the quotation is accepted." />

      <form onSubmit={submit} className="space-y-6" noValidate>
        {errors.form && <Alert>{errors.form}</Alert>}
        {(options.plans.length === 0 || options.products.length === 0) && (
          <Alert>
            {options.plans.length === 0 && (
              <>
                There are no plans available to sell today. <Link href="/plans" className="font-medium underline">Set up a plan</Link>.{" "}
              </>
            )}
            {options.products.length === 0 && (
              <>
                There are no active products. <Link href="/products" className="font-medium underline">Add a product</Link>.
              </>
            )}
          </Alert>
        )}

        <Card className="space-y-5 p-6">
          <h2 className="font-semibold">Customer &amp; plan</h2>
          <div className="grid gap-5 md:grid-cols-2">
            <CustomerPicker value={customer} onChange={setCustomer} error={submitted ? errors.customer : undefined} />
            <SelectField label="Start from a template (optional)" value={templateId} onChange={(e) => (e.target.value ? pickTemplate(e.target.value) : setTemplateId(""))} hint="Fills in the plan and product lines.">
              <option value="">No template</option>
              {options.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Plan"
              value={template?.planId ?? planId}
              disabled={!!template}
              onChange={(e) => setPlanId(e.target.value)}
              error={submitted ? errors.plan : undefined}
              hint={template ? "Set by the template." : undefined}
            >
              <option value="">Select a plan…</option>
              {options.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {billingCycle(p)}
                </option>
              ))}
            </SelectField>
            <SelectField label="Payment terms" value={termId} onChange={(e) => setTermId(e.target.value)} hint="How long the customer has to pay each invoice.">
              {options.paymentTerms.length === 0 && <option value="">No payment terms configured</option>}
              {options.paymentTerms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={submitted ? errors.startDate : undefined} />
            <Input label="Expiry date (optional)" type="date" min={startDate || undefined} value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} error={submitted ? errors.expiryDate : undefined} hint="Leave empty for an open-ended subscription." />
          </div>

          {plan && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="font-medium">{plan.name}</span>
              <span className="text-muted">billed {billingCycle(plan).toLowerCase()}</span>
              {plan.minQuantity > 1 && <Badge>min. quantity {plan.minQuantity}</Badge>}
              <Badge tone={plan.allowPause ? "success" : "neutral"}>{plan.allowPause ? "can pause" : "no pause"}</Badge>
              <Badge tone={plan.allowEarlyClose ? "success" : "neutral"}>{plan.allowEarlyClose ? "early close allowed" : "no early close"}</Badge>
              <Badge tone={plan.allowRenewal ? "success" : "neutral"}>{plan.allowRenewal ? "renewable" : "not renewable"}</Badge>
            </div>
          )}
        </Card>

        <Card className="space-y-4 p-6">
          <div>
            <h2 className="font-semibold">Products</h2>
            <p className="text-sm text-muted">Prices come from the catalog. Type a price to override it for this customer.</p>
          </div>
          <LinesEditor options={options} lines={lines} onChange={setLines} showErrors={submitted} />
          {submitted && errors.lines && <p role="alert" className="text-sm text-danger">{errors.lines}</p>}
        </Card>

        <Card className="p-6">
          <Textarea label="Internal notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} hint="Only staff can see these." />
        </Card>

        <div className="flex justify-end gap-2">
          <Link href="/subscriptions">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={create.isPending}>
            Create draft
          </Button>
        </div>
      </form>
    </>
  );
}
