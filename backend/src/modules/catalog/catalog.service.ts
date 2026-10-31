/**
 * Catalog service: taxes, products (+ variants) and payment terms.
 *
 * Rules enforced here (the database backs the important ones up):
 *  - Money leaves the API as fixed 2-decimal strings (never raw Decimals, which print as "1000" instead of "1000.00").
 *  - Master data is SOFT-deleted, and refused while something live still depends on it: deleting a product that
 *    active subscriptions bill, or a tax a product defaults to, would silently change what customers are charged.
 *    The error says what depends on it and suggests deactivating instead (deactivate = stop selling, keep billing).
 *  - Names are unique among LIVE rows, case-insensitively (a deleted tax doesn't block re-using its name).
 */

import { Prisma } from "../../generated/prisma/client.js";
import { domainError, notFound, conflict } from "../../lib/errors.js";
import { money } from "../../lib/money.js";
import { prisma } from "../../lib/prisma.js";
import { pageArgs, pageResult, type Pagination, type Tx } from "../../lib/shared.js";
import type { CreatePaymentTermInput, CreateProductInput, CreateTaxInput, CreateVariantInput, UpdatePaymentTermInput, UpdateProductInput, UpdateTaxInput, UpdateVariantInput } from "./catalog.schemas.js";

const isUnique = (err: unknown) => (err as { code?: string }).code === "P2002";
const stable = [{ createdAt: "desc" as const }, { id: "asc" as const }]; // id tie-break → pages never repeat or skip rows

const inUse = (what: string, details: Record<string, number>, hint = "Deactivate it instead: it stops being offered but existing subscriptions keep billing.") => {
  const parts = Object.entries(details).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  return domainError("IN_USE", `${what} is still used by ${parts.join(", ")}. ${hint}`, details);
};

// ==================== DTOs ====================

type TaxRow = Prisma.TaxGetPayload<object>;
const taxDto = (t: TaxRow) => ({ id: t.id, name: t.name, ratePercent: money(t.ratePercent), isActive: t.isActive, createdAt: t.createdAt, updatedAt: t.updatedAt });

type VariantRow = Prisma.ProductVariantGetPayload<object>;
const variantDto = (v: VariantRow) => ({
  id: v.id,
  productId: v.productId,
  attribute: v.attribute,
  value: v.value,
  extraPrice: money(v.extraPrice),
  isActive: v.isActive,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

const productInclude = { tax: true, variants: { orderBy: [{ attribute: "asc" }, { value: "asc" }] } } satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
const productDto = (p: ProductRow) => ({
  id: p.id,
  name: p.name,
  type: p.type,
  salesPrice: money(p.salesPrice),
  costPrice: money(p.costPrice),
  notes: p.notes,
  taxId: p.taxId,
  tax: p.tax && !p.tax.deletedAt ? taxDto(p.tax) : null,
  variants: p.variants.map(variantDto),
  isActive: p.isActive,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

type TermRow = Prisma.PaymentTermGetPayload<object>;
const termDto = (t: TermRow) => ({ id: t.id, name: t.name, dueDays: t.dueDays, isDefault: t.isDefault, createdAt: t.createdAt, updatedAt: t.updatedAt });

/** The tax a product points at must exist, be live, and be active (offering a dead tax would bill with a rate nobody maintains). */
async function assertUsableTax(db: Tx, taxId: string) {
  const tax = await db.tax.findFirst({ where: { id: taxId, deletedAt: null, isActive: true }, select: { id: true } });
  if (!tax) throw domainError("TAX_UNAVAILABLE", "That tax doesn't exist or is inactive");
}

// ==================== TAXES ====================

export async function createTax(input: CreateTaxInput) {
  try {
    return taxDto(await prisma.tax.create({ data: { name: input.name, ratePercent: input.ratePercent, isActive: input.isActive } }));
  } catch (err) {
    if (isUnique(err)) throw conflict(`A tax named "${input.name}" already exists`);
    throw err;
  }
}

async function findTax(id: string) {
  const tax = await prisma.tax.findFirst({ where: { id, deletedAt: null } });
  if (!tax) throw notFound("Tax");
  return tax;
}

export async function getTaxById(id: string) {
  return taxDto(await findTax(id));
}

export async function listTaxes(params: Pagination & { search?: string; isActive?: boolean }) {
  const where: Prisma.TaxWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.search && { name: { contains: params.search, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([prisma.tax.findMany({ where, orderBy: stable, ...pageArgs(params) }), prisma.tax.count({ where })]);
  return pageResult(items.map(taxDto), total, params);
}

export async function updateTax(id: string, input: UpdateTaxInput) {
  await findTax(id);
  try {
    return taxDto(await prisma.tax.update({ where: { id }, data: input }));
  } catch (err) {
    if (isUnique(err)) throw conflict(`A tax named "${input.name}" already exists`);
    throw err;
  }
}

export async function softDeleteTax(id: string) {
  await findTax(id);
  const [products, subscriptionLines] = await Promise.all([
    prisma.product.count({ where: { taxId: id, deletedAt: null } }),
    prisma.subscriptionLine.count({ where: { taxId: id, subscription: { status: { not: "CLOSED" } } } }),
  ]);
  if (products || subscriptionLines) throw inUse("This tax", { products, "subscription lines": subscriptionLines });
  await prisma.tax.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ==================== PRODUCTS ====================

export async function createProduct(input: CreateProductInput) {
  if (input.taxId) await assertUsableTax(prisma, input.taxId);
  try {
    return productDto(await prisma.product.create({ data: input, include: productInclude, relationLoadStrategy: "join" }));
  } catch (err) {
    if (isUnique(err)) throw conflict(`A product named "${input.name}" already exists`);
    throw err;
  }
}

async function findProduct(id: string) {
  const product = await prisma.product.findFirst({ where: { id, deletedAt: null }, include: productInclude, relationLoadStrategy: "join" });
  if (!product) throw notFound("Product");
  return product;
}

export async function getProductById(id: string) {
  return productDto(await findProduct(id));
}

export async function listProducts(params: Pagination & { search?: string; type?: "SERVICE" | "GOODS"; isActive?: boolean }) {
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.type && { type: params.type }),
    ...(params.search && { name: { contains: params.search, mode: "insensitive" } }),
  };
  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, include: productInclude, relationLoadStrategy: "join", orderBy: stable, ...pageArgs(params) }),
    prisma.product.count({ where }),
  ]);
  return pageResult(items.map(productDto), total, params);
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  await findProduct(id);
  if (input.taxId) await assertUsableTax(prisma, input.taxId);
  try {
    return productDto(await prisma.product.update({ where: { id }, data: input, include: productInclude, relationLoadStrategy: "join" }));
  } catch (err) {
    if (isUnique(err)) throw conflict(`A product named "${input.name}" already exists`);
    throw err;
  }
}

export async function softDeleteProduct(id: string) {
  await findProduct(id);
  const [subscriptionLines, templates, discounts] = await Promise.all([
    prisma.subscriptionLine.count({ where: { productId: id, subscription: { status: { not: "CLOSED" } } } }),
    prisma.quotationTemplateLine.count({ where: { productId: id, template: { deletedAt: null } } }),
    prisma.discountProduct.count({ where: { productId: id, discount: { deletedAt: null } } }),
  ]);
  if (subscriptionLines || templates || discounts) {
    throw inUse("This product", { "subscription lines": subscriptionLines, "quotation template lines": templates, discounts });
  }
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ==================== PRODUCT VARIANTS ====================

export async function createProductVariant(productId: string, input: CreateVariantInput) {
  await findProduct(productId);
  try {
    return variantDto(await prisma.productVariant.create({ data: { productId, ...input } }));
  } catch (err) {
    if (isUnique(err)) throw conflict(`This product already has a "${input.attribute}: ${input.value}" variant`);
    throw err;
  }
}

export async function listProductVariants(productId: string) {
  await findProduct(productId);
  const rows = await prisma.productVariant.findMany({ where: { productId }, orderBy: [{ attribute: "asc" }, { value: "asc" }] });
  return rows.map(variantDto);
}

async function findVariant(productId: string, variantId: string) {
  const variant = await prisma.productVariant.findFirst({ where: { id: variantId, productId, product: { deletedAt: null } } });
  if (!variant) throw notFound("Variant");
  return variant;
}

export async function updateProductVariant(productId: string, variantId: string, input: UpdateVariantInput) {
  await findVariant(productId, variantId);
  try {
    return variantDto(await prisma.productVariant.update({ where: { id: variantId }, data: input }));
  } catch (err) {
    if (isUnique(err)) throw conflict("This product already has a variant with that attribute and value");
    throw err;
  }
}

/**
 * Variants are hard-deleted, so only one nothing live depends on can go; anything ever sold must be deactivated instead.
 * Lines of soft-deleted templates are dead data and are cleaned up with it (they would otherwise block the delete forever).
 */
export async function deleteProductVariant(productId: string, variantId: string) {
  await findVariant(productId, variantId);
  const [subscriptionLines, templates] = await Promise.all([
    prisma.subscriptionLine.count({ where: { variantId } }),
    prisma.quotationTemplateLine.count({ where: { variantId, template: { deletedAt: null } } }),
  ]);
  if (subscriptionLines || templates) {
    throw inUse("This variant", { "subscription lines": subscriptionLines, "quotation template lines": templates }, "Deactivate it instead so it can't be picked for new lines.");
  }
  await prisma.$transaction([prisma.quotationTemplateLine.deleteMany({ where: { variantId } }), prisma.productVariant.delete({ where: { id: variantId } })]);
}

// ==================== PAYMENT TERMS ====================

export async function createPaymentTerm(input: CreatePaymentTermInput) {
  try {
    return termDto(
      await prisma.$transaction(async (tx) => {
        // exactly one default at a time (also enforced by a partial unique index)
        if (input.isDefault) await tx.paymentTerm.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        return tx.paymentTerm.create({ data: input });
      }),
    );
  } catch (err) {
    if (isUnique(err)) throw conflict(`A payment term named "${input.name}" already exists (or another default was set at the same moment)`);
    throw err;
  }
}

async function findTerm(id: string) {
  const term = await prisma.paymentTerm.findUnique({ where: { id } });
  if (!term) throw notFound("Payment term");
  return term;
}

export async function getPaymentTermById(id: string) {
  return termDto(await findTerm(id));
}

export async function listPaymentTerms(params: Pagination & { search?: string }) {
  const where: Prisma.PaymentTermWhereInput = { ...(params.search && { name: { contains: params.search, mode: "insensitive" } }) };
  const [items, total] = await Promise.all([
    prisma.paymentTerm.findMany({ where, orderBy: [{ dueDays: "asc" }, { id: "asc" }], ...pageArgs(params) }),
    prisma.paymentTerm.count({ where }),
  ]);
  return pageResult(items.map(termDto), total, params);
}

export async function updatePaymentTerm(id: string, input: UpdatePaymentTermInput) {
  await findTerm(id);
  try {
    return termDto(
      await prisma.$transaction(async (tx) => {
        if (input.isDefault) await tx.paymentTerm.updateMany({ where: { id: { not: id }, isDefault: true }, data: { isDefault: false } });
        return tx.paymentTerm.update({ where: { id }, data: input });
      }),
    );
  } catch (err) {
    if (isUnique(err)) throw conflict(`A payment term named "${input.name}" already exists (or another default was set at the same moment)`);
    throw err;
  }
}

/** Payment terms have no soft-delete (they are referenced by every subscription), so one in use can't be removed. */
export async function deletePaymentTerm(id: string) {
  await findTerm(id);
  const subscriptions = await prisma.subscription.count({ where: { paymentTermId: id } });
  if (subscriptions) throw inUse("This payment term", { subscriptions }, "Rename it, or create a new term and move new subscriptions to it.");
  await prisma.paymentTerm.delete({ where: { id } });
}
