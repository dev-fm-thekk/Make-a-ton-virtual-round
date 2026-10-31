/**
 * Catalog Service
 * Handles business logic, transactional integrity, soft deletes, and DB queries for:
 * - Taxes (rate percentages, master records)
 * - Products & Product Variants (pricing, active state, attribute variants e.g. brand)
 * - Payment Terms (due days, default payment term flag)
 */

import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { notFound, conflict } from "../../lib/errors.js";
import { pageArgs, pageResult, type Pagination } from "../../lib/shared.js";

// ==================== TAXES ====================

export interface CreateTaxInput {
  name: string;
  ratePercent: string;
  isActive?: boolean;
}

export interface UpdateTaxInput {
  name?: string;
  ratePercent?: string;
  isActive?: boolean;
}

export async function createTax(input: CreateTaxInput) {
  try {
    return await prisma.tax.create({
      data: {
        name: input.name,
        ratePercent: new Prisma.Decimal(input.ratePercent),
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw conflict(`Tax with name "${input.name}" already exists`);
    }
    throw err;
  }
}

export async function getTaxById(id: string) {
  const tax = await prisma.tax.findFirst({
    where: { id, deletedAt: null },
  });
  if (!tax) throw notFound("Tax");
  return tax;
}

export async function listTaxes(params: Pagination & { search?: string; isActive?: boolean }) {
  const where: Prisma.TaxWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.search && {
      name: { contains: params.search, mode: "insensitive" },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.tax.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...pageArgs(params),
    }),
    prisma.tax.count({ where }),
  ]);

  return pageResult(items, total, params);
}

export async function updateTax(id: string, input: UpdateTaxInput) {
  await getTaxById(id);
  try {
    return await prisma.tax.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.ratePercent !== undefined && { ratePercent: new Prisma.Decimal(input.ratePercent) }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw conflict(`Tax with name "${input.name}" already exists`);
    }
    throw err;
  }
}

export async function softDeleteTax(id: string) {
  await getTaxById(id);
  return prisma.tax.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ==================== PRODUCTS ====================

export interface CreateProductInput {
  name: string;
  type: "SERVICE" | "GOODS";
  salesPrice: string;
  costPrice: string;
  notes?: string;
  taxId?: string | null;
  isActive?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  type?: "SERVICE" | "GOODS";
  salesPrice?: string;
  costPrice?: string;
  notes?: string | null;
  taxId?: string | null;
  isActive?: boolean;
}

export async function createProduct(input: CreateProductInput) {
  if (input.taxId) {
    const tax = await prisma.tax.findFirst({ where: { id: input.taxId, deletedAt: null } });
    if (!tax) throw notFound("Tax");
  }

  return prisma.product.create({
    data: {
      name: input.name,
      type: input.type,
      salesPrice: new Prisma.Decimal(input.salesPrice),
      costPrice: new Prisma.Decimal(input.costPrice),
      notes: input.notes,
      taxId: input.taxId,
      isActive: input.isActive ?? true,
    },
    include: {
      tax: true,
      variants: true,
    },
  });
}

export async function getProductById(id: string) {
  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      tax: true,
      variants: true,
    },
  });
  if (!product) throw notFound("Product");
  return product;
}

export async function listProducts(params: Pagination & { search?: string; type?: "SERVICE" | "GOODS"; isActive?: boolean }) {
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.type !== undefined && { type: params.type }),
    ...(params.search && {
      name: { contains: params.search, mode: "insensitive" },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        tax: true,
        variants: true,
      },
      orderBy: { createdAt: "desc" },
      ...pageArgs(params),
    }),
    prisma.product.count({ where }),
  ]);

  return pageResult(items, total, params);
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  await getProductById(id);
  if (input.taxId) {
    const tax = await prisma.tax.findFirst({ where: { id: input.taxId, deletedAt: null } });
    if (!tax) throw notFound("Tax");
  }

  return prisma.product.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.salesPrice !== undefined && { salesPrice: new Prisma.Decimal(input.salesPrice) }),
      ...(input.costPrice !== undefined && { costPrice: new Prisma.Decimal(input.costPrice) }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.taxId !== undefined && { taxId: input.taxId }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    include: {
      tax: true,
      variants: true,
    },
  });
}

export async function softDeleteProduct(id: string) {
  await getProductById(id);
  return prisma.product.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ==================== PRODUCT VARIANTS ====================

export interface CreateVariantInput {
  attribute: string;
  value: string;
  extraPrice?: string;
  isActive?: boolean;
}

export interface UpdateVariantInput {
  attribute?: string;
  value?: string;
  extraPrice?: string;
  isActive?: boolean;
}

export async function createProductVariant(productId: string, input: CreateVariantInput) {
  await getProductById(productId);
  try {
    return await prisma.productVariant.create({
      data: {
        productId,
        attribute: input.attribute,
        value: input.value,
        extraPrice: new Prisma.Decimal(input.extraPrice ?? "0.00"),
        isActive: input.isActive ?? true,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw conflict(`Variant with attribute "${input.attribute}" and value "${input.value}" already exists for this product`);
    }
    throw err;
  }
}

export async function listProductVariants(productId: string) {
  await getProductById(productId);
  return prisma.productVariant.findMany({
    where: { productId },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateProductVariant(productId: string, variantId: string, input: UpdateVariantInput) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
  });
  if (!variant) throw notFound("ProductVariant");

  try {
    return await prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(input.attribute !== undefined && { attribute: input.attribute }),
        ...(input.value !== undefined && { value: input.value }),
        ...(input.extraPrice !== undefined && { extraPrice: new Prisma.Decimal(input.extraPrice) }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw conflict(`Variant with attribute "${input.attribute}" and value "${input.value}" already exists for this product`);
    }
    throw err;
  }
}

export async function deleteProductVariant(productId: string, variantId: string) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
  });
  if (!variant) throw notFound("ProductVariant");

  return prisma.productVariant.delete({
    where: { id: variantId },
  });
}

// ==================== PAYMENT TERMS ====================

export interface CreatePaymentTermInput {
  name: string;
  dueDays: number;
  isDefault?: boolean;
}

export interface UpdatePaymentTermInput {
  name?: string;
  dueDays?: number;
  isDefault?: boolean;
}

export async function createPaymentTerm(input: CreatePaymentTermInput) {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.paymentTerm.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    try {
      return await tx.paymentTerm.create({
        data: {
          name: input.name,
          dueDays: input.dueDays,
          isDefault: input.isDefault ?? false,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict(`Payment term "${input.name}" already exists`);
      }
      throw err;
    }
  });
}

export async function getPaymentTermById(id: string) {
  const pt = await prisma.paymentTerm.findUnique({
    where: { id },
  });
  if (!pt) throw notFound("PaymentTerm");
  return pt;
}

export async function listPaymentTerms(params: Pagination & { search?: string }) {
  const where: Prisma.PaymentTermWhereInput = {
    ...(params.search && {
      name: { contains: params.search, mode: "insensitive" },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.paymentTerm.findMany({
      where,
      orderBy: { dueDays: "asc" },
      ...pageArgs(params),
    }),
    prisma.paymentTerm.count({ where }),
  ]);

  return pageResult(items, total, params);
}

export async function updatePaymentTerm(id: string, input: UpdatePaymentTermInput) {
  await getPaymentTermById(id);
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.paymentTerm.updateMany({
        where: { id: { not: id }, isDefault: true },
        data: { isDefault: false },
      });
    }
    try {
      return await tx.paymentTerm.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.dueDays !== undefined && { dueDays: input.dueDays }),
          ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw conflict(`Payment term "${input.name}" already exists`);
      }
      throw err;
    }
  });
}

export async function deletePaymentTerm(id: string) {
  await getPaymentTermById(id);
  return prisma.paymentTerm.delete({
    where: { id },
  });
}
