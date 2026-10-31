"use client";

import { Plus, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { fromCents } from "@/lib/cents";
import { Button, Select } from "@/components/ui";
import { blankLine, catalogUnitCents, lineProblem, previewLine, previewTotals } from "./preview";
import type { DraftLine, FormOptions } from "./types";

const cell = "px-2 py-2 align-top";

/**
 * Editable product lines with a live price preview. Prices default to the catalog (product + variant extra);
 * typing a price overrides it. The server recomputes everything on save.
 */
export function LinesEditor({ options, lines, onChange, showErrors, disabled }: { options: FormOptions; lines: DraftLine[]; onChange: (l: DraftLine[]) => void; showErrors?: boolean; disabled?: boolean }) {
  const set = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totals = previewTotals(lines, options);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className={`${cell} font-medium`}>Product</th>
              <th className={`${cell} font-medium`}>Variant</th>
              <th className={`${cell} w-24 font-medium`}>Qty</th>
              <th className={`${cell} w-36 font-medium`}>Unit price</th>
              <th className={`${cell} w-40 font-medium`}>Tax</th>
              <th className={`${cell} w-32 text-right font-medium`}>Amount</th>
              <th className={`${cell} w-10`} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No products yet. Add a line to start.
                </td>
              </tr>
            )}
            {lines.map((line, i) => {
              const product = options.products.find((p) => p.id === line.productId);
              const preview = previewLine(line, options);
              const problem = showErrors ? lineProblem(line) : null;
              const catalog = catalogUnitCents(product, line.variantId);
              return (
                <tr key={line.key}>
                  <td className={cell}>
                    <Select
                      aria-label={`Line ${i + 1} product`}
                      value={line.productId}
                      disabled={disabled}
                      aria-invalid={!!problem && !line.productId}
                      onChange={(e) => set(line.key, { productId: e.target.value, variantId: "", unitPrice: "", taxChoice: "" })}
                    >
                      <option value="">Select a product…</option>
                      {options.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                    {problem && <p role="alert" className="mt-1 text-xs text-danger">{problem}</p>}
                  </td>
                  <td className={cell}>
                    <Select aria-label={`Line ${i + 1} variant`} value={line.variantId} disabled={disabled || !product || product.variants.length === 0} onChange={(e) => set(line.key, { variantId: e.target.value })}>
                      <option value="">{product && product.variants.length ? "No variant" : "—"}</option>
                      {product?.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.attribute}: {v.value}
                          {Number(v.extraPrice) ? ` (+${formatMoney(v.extraPrice)})` : ""}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={cell}>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      aria-label={`Line ${i + 1} quantity`}
                      value={Number.isNaN(line.quantity) ? "" : line.quantity}
                      disabled={disabled}
                      onChange={(e) => set(line.key, { quantity: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                      className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:border-ring disabled:opacity-60"
                    />
                  </td>
                  <td className={cell}>
                    <input
                      inputMode="decimal"
                      aria-label={`Line ${i + 1} unit price`}
                      value={line.unitPrice}
                      disabled={disabled || !product}
                      placeholder={Number.isFinite(catalog) ? fromCents(catalog) : "—"}
                      onChange={(e) => set(line.key, { unitPrice: e.target.value })}
                      className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm tabular-nums placeholder:text-muted/70 focus:border-ring disabled:opacity-60"
                    />
                    {preview.overridden && <p className="mt-1 text-xs text-warning">Custom price</p>}
                  </td>
                  <td className={cell}>
                    <Select aria-label={`Line ${i + 1} tax`} value={line.taxChoice} disabled={disabled || !product} onChange={(e) => set(line.key, { taxChoice: e.target.value })}>
                      <option value="">
                        Default ({options.taxes.find((t) => t.id === product?.taxId)?.name ?? "no tax"})
                      </option>
                      <option value="none">No tax</option>
                      {options.taxes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({Number(t.ratePercent)}%)
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={`${cell} pt-4 text-right tabular-nums`}>{preview.math ? formatMoney(fromCents(preview.math.amount)) : "—"}</td>
                  <td className={cell}>
                    <button
                      type="button"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={disabled}
                      onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                      className="mt-1.5 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => onChange([...lines, blankLine()])}>
          <Plus className="size-4" aria-hidden /> Add line
        </Button>
        <dl className="min-w-60 space-y-1 text-sm" aria-label="Estimated totals per billing period">
          <div className="flex justify-between gap-8">
            <dt className="text-muted">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(totals.untaxed)}</dd>
          </div>
          <div className="flex justify-between gap-8">
            <dt className="text-muted">Tax</dt>
            <dd className="tabular-nums">{formatMoney(totals.tax)}</dd>
          </div>
          <div className="flex justify-between gap-8 border-t border-border pt-1 font-semibold">
            <dt>Total per period</dt>
            <dd className="tabular-nums">{formatMoney(totals.total)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
