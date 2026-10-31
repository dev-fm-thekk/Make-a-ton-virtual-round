"use client";

import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { useFormOptions } from "@/features/subscriptions/api";

/**
 * Shown on the staff dashboard until the catalog has what a first subscription needs. One cached request
 * (`/subscriptions/options`), the same one the subscription form uses, so it costs nothing extra there.
 */
export function SetupChecklist() {
  const { data } = useFormOptions();
  if (!data) return null;

  const steps = [
    { done: data.taxes.length > 0, label: "Add a tax rate", href: "/taxes", optional: true },
    { done: data.paymentTerms.length > 0, label: "Add payment terms", href: "/payment-terms" },
    { done: data.products.length > 0, label: "Add a product", href: "/products" },
    { done: data.plans.length > 0, label: "Create a plan customers can buy", href: "/plans" },
    { done: data.templates.length > 0, label: "Save a quotation template", href: "/quotation-templates", optional: true },
  ];
  // Optional steps never keep the card on screen.
  if (steps.every((s) => s.done || s.optional)) return null;

  return (
    <Card className="mb-6 p-5">
      <h2 className="font-semibold">Finish setting up</h2>
      <p className="mb-3 text-sm text-muted">You need these before the first subscription can be created. Admins can add them.</p>
      <ul className="space-y-2 text-sm">
        {steps.map((s) => (
          <li key={s.href} className="flex items-center gap-2">
            {s.done ? <CheckCircle2 className="size-4 text-success" aria-label="Done" /> : <Circle className="size-4 text-muted" aria-label="To do" />}
            <Link href={s.href} className={s.done ? "text-muted line-through" : "text-primary hover:underline"}>
              {s.label}
            </Link>
            {s.optional && !s.done && <span className="text-xs text-muted">(optional)</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
