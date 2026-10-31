import { badRequest } from "../../lib/errors.js";
import { D, lineAmounts, round2, sum, type Decimal, type Num } from "../../lib/money.js";
import type { Tx } from "../../lib/shared.js";
import type { LineInput } from "./subscriptions.schemas.js";

export interface ResolvedLine {
  productId: string;
  variantId: string | null;
  taxId: string | null;
  description: string;
  quantity: number;
  unitPrice: Decimal;
  amount: Decimal;
  sortOrder: number;
}

/**
 * Turns request lines into rows ready to store: validates every referenced product / variant / tax,
 * fills in catalog prices and default taxes, and computes each line amount.
 *  - unit price  = product.salesPrice + variant.extraPrice   (unless the staff member overrides it)
 *  - tax         = product.taxId                             (unless overridden; `null` = untaxed)
 */
export async function resolveLines(tx: Tx, inputs: LineInput[]): Promise<ResolvedLine[]> {
  if (inputs.length === 0) return [];

  const productIds = [...new Set(inputs.map((l) => l.productId))];
  const variantIds = [...new Set(inputs.map((l) => l.variantId).filter((v): v is string => !!v))];
  const taxIds = [...new Set(inputs.map((l) => l.taxId).filter((v): v is string => !!v))];

  const [products, variants, overrideTaxes] = await Promise.all([
    tx.product.findMany({ where: { id: { in: productIds }, deletedAt: null, isActive: true } }),
    variantIds.length ? tx.productVariant.findMany({ where: { id: { in: variantIds }, isActive: true } }) : [],
    taxIds.length ? tx.tax.findMany({ where: { id: { in: taxIds }, deletedAt: null, isActive: true }, select: { id: true } }) : [],
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const validTax = new Set(overrideTaxes.map((t) => t.id));

  return inputs.map((l, i) => {
    const where = `lines[${i}]`;
    const product = productById.get(l.productId);
    if (!product) throw badRequest(`${where}: product not found or inactive`, { line: i, productId: l.productId });

    let extra: Num = 0;
    let variantLabel = "";
    if (l.variantId) {
      const variant = variantById.get(l.variantId);
      if (!variant || variant.productId !== product.id) throw badRequest(`${where}: variant does not belong to this product`, { line: i, variantId: l.variantId });
      extra = variant.extraPrice;
      variantLabel = ` (${variant.attribute}: ${variant.value})`;
    }

    let taxId: string | null;
    if (l.taxId === undefined) taxId = product.taxId;
    else if (l.taxId === null) taxId = null;
    else {
      if (!validTax.has(l.taxId)) throw badRequest(`${where}: tax not found or inactive`, { line: i, taxId: l.taxId });
      taxId = l.taxId;
    }

    const unitPrice = l.unitPrice !== undefined ? round2(l.unitPrice) : round2(D(product.salesPrice).plus(extra));
    return {
      productId: product.id,
      variantId: l.variantId ?? null,
      taxId,
      description: l.description || `${product.name}${variantLabel}`,
      quantity: l.quantity,
      unitPrice,
      amount: round2(unitPrice.times(l.quantity)),
      sortOrder: i,
    };
  });
}

export interface PricedLine {
  quantity: number;
  unitPrice: Num;
  taxRatePercent: Num;
}

/** Per-period totals (before discounts, which are applied at invoicing time). */
export function totalsOf(lines: PricedLine[]) {
  const parts = lines.map((l) => lineAmounts(l.quantity, l.unitPrice, l.taxRatePercent));
  const untaxed = sum(parts.map((p) => p.amount));
  const tax = sum(parts.map((p) => p.tax));
  return { untaxed, tax, total: untaxed.plus(tax) };
}
