/**
 * Plans & Quotation Templates Service
 * Handles business logic, transactional integrity, soft deletes, and DB queries for:
 * - Plans (pricing, billing periods, lifecycle flags e.g. pause/renewal/early-close/auto-close)
 * - Quotation Templates & Template Lines (pre-configured product/variant bundles for quotes)
 */

import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { notFound, badRequest } from "../../lib/errors.js";
import { pageArgs, pageResult, type Pagination } from "../../lib/shared.js";

// ==================== PLANS ====================

export interface CreatePlanInput {
  name: string;
  price: string;
  billingPeriod: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  billingInterval?: number;
  minQuantity?: number;
  availableFrom: string;
  availableUntil?: string | null;
  autoCloseOnEnd?: boolean;
  allowEarlyClose?: boolean;
  allowPause?: boolean;
  allowRenewal?: boolean;
  isActive?: boolean;
}

export interface UpdatePlanInput {
  name?: string;
  price?: string;
  billingPeriod?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  billingInterval?: number;
  minQuantity?: number;
  availableFrom?: string;
  availableUntil?: string | null;
  autoCloseOnEnd?: boolean;
  allowEarlyClose?: boolean;
  allowPause?: boolean;
  allowRenewal?: boolean;
  isActive?: boolean;
}

export async function createPlan(input: CreatePlanInput) {
  const from = new Date(input.availableFrom);
  const until = input.availableUntil ? new Date(input.availableUntil) : null;
  if (until && until < from) {
    throw badRequest("availableUntil cannot be before availableFrom");
  }

  return prisma.plan.create({
    data: {
      name: input.name,
      price: new Prisma.Decimal(input.price),
      billingPeriod: input.billingPeriod,
      billingInterval: input.billingInterval ?? 1,
      minQuantity: input.minQuantity ?? 1,
      availableFrom: from,
      availableUntil: until,
      autoCloseOnEnd: input.autoCloseOnEnd ?? false,
      allowEarlyClose: input.allowEarlyClose ?? false,
      allowPause: input.allowPause ?? false,
      allowRenewal: input.allowRenewal ?? true,
      isActive: input.isActive ?? true,
    },
  });
}

export async function getPlanById(id: string) {
  const plan = await prisma.plan.findFirst({
    where: { id, deletedAt: null },
  });
  if (!plan) throw notFound("Plan");
  return plan;
}

export async function listPlans(params: Pagination & { search?: string; billingPeriod?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; isActive?: boolean }) {
  const where: Prisma.PlanWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.billingPeriod !== undefined && { billingPeriod: params.billingPeriod }),
    ...(params.search && {
      name: { contains: params.search, mode: "insensitive" },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.plan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...pageArgs(params),
    }),
    prisma.plan.count({ where }),
  ]);

  return pageResult(items, total, params);
}

export async function updatePlan(id: string, input: UpdatePlanInput) {
  const existing = await getPlanById(id);

  const from = input.availableFrom ? new Date(input.availableFrom) : existing.availableFrom;
  const until = input.availableUntil !== undefined ? (input.availableUntil ? new Date(input.availableUntil) : null) : existing.availableUntil;
  if (until && until < from) {
    throw badRequest("availableUntil cannot be before availableFrom");
  }

  return prisma.plan.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.price !== undefined && { price: new Prisma.Decimal(input.price) }),
      ...(input.billingPeriod !== undefined && { billingPeriod: input.billingPeriod }),
      ...(input.billingInterval !== undefined && { billingInterval: input.billingInterval }),
      ...(input.minQuantity !== undefined && { minQuantity: input.minQuantity }),
      ...(input.availableFrom !== undefined && { availableFrom: from }),
      ...(input.availableUntil !== undefined && { availableUntil: until }),
      ...(input.autoCloseOnEnd !== undefined && { autoCloseOnEnd: input.autoCloseOnEnd }),
      ...(input.allowEarlyClose !== undefined && { allowEarlyClose: input.allowEarlyClose }),
      ...(input.allowPause !== undefined && { allowPause: input.allowPause }),
      ...(input.allowRenewal !== undefined && { allowRenewal: input.allowRenewal }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
}

export async function softDeletePlan(id: string) {
  await getPlanById(id);
  return prisma.plan.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

// ==================== QUOTATION TEMPLATES ====================

export interface QuotationLineInput {
  productId: string;
  variantId?: string | null;
  quantity?: number;
  sortOrder?: number;
}

export interface CreateQuotationTemplateInput {
  name: string;
  planId: string;
  validityDays?: number;
  notes?: string | null;
  isActive?: boolean;
  lines?: QuotationLineInput[];
}

export interface UpdateQuotationTemplateInput {
  name?: string;
  planId?: string;
  validityDays?: number;
  notes?: string | null;
  isActive?: boolean;
  lines?: QuotationLineInput[];
}

export async function createQuotationTemplate(input: CreateQuotationTemplateInput) {
  const plan = await prisma.plan.findFirst({ where: { id: input.planId, deletedAt: null } });
  if (!plan) throw notFound("Plan");

  if (input.lines && input.lines.length > 0) {
    for (const line of input.lines) {
      const product = await prisma.product.findFirst({ where: { id: line.productId, deletedAt: null } });
      if (!product) throw notFound(`Product ${line.productId}`);
      if (line.variantId) {
        const variant = await prisma.productVariant.findFirst({ where: { id: line.variantId, productId: line.productId } });
        if (!variant) throw notFound(`Variant ${line.variantId} for product ${line.productId}`);
      }
    }
  }

  return prisma.quotationTemplate.create({
    data: {
      name: input.name,
      planId: input.planId,
      validityDays: input.validityDays ?? 30,
      notes: input.notes,
      isActive: input.isActive ?? true,
      lines: {
        create: (input.lines ?? []).map((line, idx) => ({
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity ?? 1,
          sortOrder: line.sortOrder ?? idx,
        })),
      },
    },
    include: {
      plan: true,
      lines: {
        include: {
          product: true,
          variant: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

export async function getQuotationTemplateById(id: string) {
  const template = await prisma.quotationTemplate.findFirst({
    where: { id, deletedAt: null },
    include: {
      plan: true,
      lines: {
        include: {
          product: true,
          variant: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!template) throw notFound("QuotationTemplate");
  return template;
}

export async function listQuotationTemplates(params: Pagination & { search?: string; planId?: string; isActive?: boolean }) {
  const where: Prisma.QuotationTemplateWhereInput = {
    deletedAt: null,
    ...(params.isActive !== undefined && { isActive: params.isActive }),
    ...(params.planId !== undefined && { planId: params.planId }),
    ...(params.search && {
      name: { contains: params.search, mode: "insensitive" },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.quotationTemplate.findMany({
      where,
      include: {
        plan: true,
        lines: {
          include: {
            product: true,
            variant: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      ...pageArgs(params),
    }),
    prisma.quotationTemplate.count({ where }),
  ]);

  return pageResult(items, total, params);
}

export async function updateQuotationTemplate(id: string, input: UpdateQuotationTemplateInput) {
  await getQuotationTemplateById(id);

  if (input.planId) {
    const plan = await prisma.plan.findFirst({ where: { id: input.planId, deletedAt: null } });
    if (!plan) throw notFound("Plan");
  }

  if (input.lines) {
    for (const line of input.lines) {
      const product = await prisma.product.findFirst({ where: { id: line.productId, deletedAt: null } });
      if (!product) throw notFound(`Product ${line.productId}`);
      if (line.variantId) {
        const variant = await prisma.productVariant.findFirst({ where: { id: line.variantId, productId: line.productId } });
        if (!variant) throw notFound(`Variant ${line.variantId} for product ${line.productId}`);
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    if (input.lines !== undefined) {
      await tx.quotationTemplateLine.deleteMany({ where: { templateId: id } });
      if (input.lines.length > 0) {
        await tx.quotationTemplateLine.createMany({
          data: input.lines.map((l, idx) => ({
            templateId: id,
            productId: l.productId,
            variantId: l.variantId ?? null,
            quantity: l.quantity ?? 1,
            sortOrder: l.sortOrder ?? idx,
          })),
        });
      }
    }

    return tx.quotationTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.planId !== undefined && { planId: input.planId }),
        ...(input.validityDays !== undefined && { validityDays: input.validityDays }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
      include: {
        plan: true,
        lines: {
          include: {
            product: true,
            variant: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  });
}

export async function softDeleteQuotationTemplate(id: string) {
  await getQuotationTemplateById(id);
  return prisma.quotationTemplate.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}
