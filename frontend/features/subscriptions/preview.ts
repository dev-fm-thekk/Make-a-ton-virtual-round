// Pure helpers behind the line editor: catalog price lookup, live totals and request mapping.
// No React here, so it is unit-tested directly.

import { fromCents, lineMath, sumLines, toCents, type LineMath } from "@/lib/cents";
import type { DraftLine, FormOptions, LinePayload, SubscriptionLine } from "./types";

type Product = FormOptions["products"][number];

let counter = 0;
export const newKey = () => `l${Date.now().toString(36)}${counter++}`;

export const blankLine = (): DraftLine => ({ key: newKey(), productId: "", variantId: "", quantity: 1, unitPrice: "", taxChoice: "" });

/** Product sales price + the chosen variant's extra, in cents. */
export function catalogUnitCents(product: Product | undefined, variantId: string): number {
  if (!product) return Number.NaN;
  const extra = variantId ? (product.variants.find((v) => v.id === variantId)?.extraPrice ?? "0") : "0";
  return toCents(product.salesPrice) + toCents(extra);
}

export interface LinePreview {
  /** Unit price actually in effect (override, else catalog). NaN when it can't be determined / is invalid. */
  unitCents: number;
  /** Tax % in effect for the line. */
  rate: string;
  math: LineMath | null;
  /** True when the user typed a price that differs from the catalog. */
  overridden: boolean;
}

export function previewLine(line: DraftLine, options: FormOptions): LinePreview {
  const product = options.products.find((p) => p.id === line.productId);
  const catalog = catalogUnitCents(product, line.variantId);
  const typed = line.unitPrice.trim();
  const unitCents = typed === "" ? catalog : toCents(typed);

  let rate = "0";
  if (line.taxChoice === "") rate = options.taxes.find((t) => t.id === product?.taxId)?.ratePercent ?? "0";
  else if (line.taxChoice !== "none") rate = options.taxes.find((t) => t.id === line.taxChoice)?.ratePercent ?? "0";

  const valid = Number.isFinite(unitCents) && Number.isInteger(line.quantity) && line.quantity >= 1;
  return { unitCents, rate, overridden: typed !== "" && unitCents !== catalog, math: valid ? lineMath(line.quantity, unitCents, rate) : null };
}

export function previewTotals(lines: DraftLine[], options: FormOptions) {
  const parts = lines.map((l) => previewLine(l, options).math).filter((m): m is LineMath => m !== null);
  const t = sumLines(parts);
  return { untaxed: fromCents(t.amount), tax: fromCents(t.tax), total: fromCents(t.total) };
}

/** A line is sendable when it names a product and has a valid quantity and (if typed) a valid price. */
export function lineProblem(line: DraftLine): string | null {
  if (!line.productId) return "Choose a product";
  if (!Number.isInteger(line.quantity) || line.quantity < 1) return "Quantity must be at least 1";
  if (line.unitPrice.trim() !== "" && !Number.isFinite(toCents(line.unitPrice))) return "Enter a price like 99.50";
  return null;
}

export function toPayload(line: DraftLine): LinePayload {
  return {
    productId: line.productId,
    variantId: line.variantId || null,
    quantity: line.quantity,
    // Only send a price when staff overrode it; otherwise the server uses the live catalog price.
    ...(line.unitPrice.trim() !== "" && { unitPrice: line.unitPrice.trim() }),
    ...(line.taxChoice === "none" ? { taxId: null } : line.taxChoice !== "" ? { taxId: line.taxChoice } : {}),
  };
}

/** Turn saved lines back into editable rows. A stored price/tax counts as "overridden" only if it differs from the catalog. */
export function fromSavedLines(lines: SubscriptionLine[], options: FormOptions): DraftLine[] {
  return lines.map((l) => {
    const product = options.products.find((p) => p.id === l.productId);
    const catalog = catalogUnitCents(product, l.variantId ?? "");
    const sameTax = (product?.taxId ?? null) === l.taxId;
    return {
      key: l.id,
      productId: l.productId,
      variantId: l.variantId ?? "",
      quantity: l.quantity,
      unitPrice: toCents(l.unitPrice) === catalog ? "" : l.unitPrice,
      taxChoice: sameTax ? "" : (l.taxId ?? "none"),
    };
  });
}
