import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { pageArgs, pageResult } from "../../lib/shared.js";
import { money } from "../../lib/money.js";
import { toDateOnly, todayUtc } from "../../lib/dates.js";
import type { ListCustomersQuery } from "./customers.schemas.js";

const customerSelect = {
  id: true,
  userId: true,
  name: true,
  companyName: true,
  email: true,
  phone: true,
  taxId: true,
  billingAddress: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof customerSelect }>;

/** `notes` are internal: never sent to the customer themselves. */
function toDto(c: CustomerRow, opts: { includeNotes: boolean }) {
  const { userId, notes, ...rest } = c;
  return { ...rest, hasPortalAccess: userId !== null, ...(opts.includeNotes ? { notes } : {}) };
}

const live = { deletedAt: null } satisfies Prisma.CustomerWhereInput;

// ───────── staff-facing ─────────

export async function listCustomers(q: ListCustomersQuery) {
  const where: Prisma.CustomerWhereInput = {
    ...live,
    ...(q.search && {
      OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { companyName: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search.toLowerCase() } },
      ],
    }),
    ...(q.hasPortalAccess !== undefined && { userId: q.hasPortalAccess ? { not: null } : null }),
  };
  const orderBy: Prisma.CustomerOrderByWithRelationInput = q.sort.startsWith("-")
    ? { [q.sort.slice(1)]: "desc" }
    : { [q.sort]: "asc" };

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }], // id tiebreak → stable pagination
      select: { ...customerSelect, _count: { select: { subscriptions: { where: { status: "ACTIVE" } } } } },
      ...pageArgs(q),
    }),
    prisma.customer.count({ where }),
  ]);
  const items = rows.map(({ _count, ...c }) => ({ ...toDto(c, { includeNotes: true }), activeSubscriptions: _count.subscriptions }));
  return pageResult(items, total, q);
}

export async function getCustomer(id: string) {
  const c = await prisma.customer.findFirst({ where: { id, ...live }, select: customerSelect });
  if (!c) throw notFound("Customer");

  // Account standing at a glance, computed in SQL (no row loading).
  const today = toDateOnly(todayUtc());
  const [subs, invoices] = await Promise.all([
    prisma.subscription.groupBy({ by: ["status"], where: { customerId: id }, _count: { _all: true } }),
    prisma.$queryRaw<{ outstanding: Prisma.Decimal | null; overdue: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM("total" - "amountPaid") FILTER (WHERE "status" = 'CONFIRMED'), 0) AS outstanding,
             COALESCE(SUM("total" - "amountPaid") FILTER (WHERE "status" = 'CONFIRMED' AND "dueDate" < ${today}::date), 0) AS overdue
      FROM "invoices" WHERE "customerId" = ${id}::uuid`,
  ]);
  return {
    ...toDto(c, { includeNotes: true }),
    subscriptionsByStatus: Object.fromEntries(subs.map((s) => [s.status, s._count._all])),
    outstandingBalance: money(invoices[0]?.outstanding),
    overdueBalance: money(invoices[0]?.overdue),
  };
}

export async function createCustomer(req: Request, input: Prisma.CustomerCreateInput) {
  // Soft duplicate guard (customer emails are deliberately not DB-unique: two contacts may share a billing mailbox).
  const dupe = await prisma.customer.findFirst({ where: { email: input.email, ...live }, select: { id: true, name: true } });
  if (dupe) throw conflict("A customer with this email already exists", { existingCustomerId: dupe.id });

  const c = await prisma.customer.create({ data: input, select: customerSelect });
  await audit(req, { action: "customer.create", entityType: "Customer", entityId: c.id });
  return toDto(c, { includeNotes: true });
}

export async function updateCustomer(req: Request, id: string, patch: Prisma.CustomerUpdateInput) {
  if (typeof patch.email === "string") {
    const dupe = await prisma.customer.findFirst({ where: { email: patch.email, id: { not: id }, ...live }, select: { id: true } });
    if (dupe) throw conflict("Another customer already uses this email", { existingCustomerId: dupe.id });
  }
  const res = await prisma.customer.updateMany({ where: { id, ...live }, data: patch as Prisma.CustomerUpdateManyMutationInput });
  if (res.count === 0) throw notFound("Customer");
  await audit(req, { action: "customer.update", entityType: "Customer", entityId: id, metadata: { fields: Object.keys(patch) } });
  return getCustomer(id);
}

/**
 * Soft delete. Refused while the customer still has live business: an unfinished subscription or an
 * unsettled invoice. Also switches off their portal login so a deleted customer can't sign in.
 */
export async function deleteCustomer(req: Request, id: string) {
  await prisma.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id, ...live }, select: { id: true, userId: true } });
    if (!c) throw notFound("Customer");

    const [openSubs, openInvoices] = await Promise.all([
      tx.subscription.count({ where: { customerId: id, status: { not: "CLOSED" } } }),
      tx.invoice.count({ where: { customerId: id, status: { in: ["DRAFT", "CONFIRMED"] } } }),
    ]);
    if (openSubs || openInvoices) {
      throw conflict("Customer still has open subscriptions or unsettled invoices", { openSubscriptions: openSubs, openInvoices });
    }

    await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
    if (c.userId) {
      await tx.user.update({ where: { id: c.userId }, data: { isActive: false } });
      await tx.refreshToken.updateMany({ where: { userId: c.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(req, { action: "customer.delete", entityType: "Customer", entityId: id }, tx);
  });
}

// ───────── customer self-service ─────────

export async function getOwnProfile(customerId: string | undefined) {
  if (!customerId) throw notFound("Customer profile");
  const c = await prisma.customer.findFirst({ where: { id: customerId, ...live }, select: customerSelect });
  if (!c) throw notFound("Customer profile");
  return toDto(c, { includeNotes: false });
}

export async function updateOwnProfile(req: Request, customerId: string | undefined, patch: Prisma.CustomerUpdateInput) {
  if (!customerId) throw badRequest("No customer profile is linked to this account");
  const res = await prisma.customer.updateMany({ where: { id: customerId, ...live }, data: patch as Prisma.CustomerUpdateManyMutationInput });
  if (res.count === 0) throw notFound("Customer profile");
  await audit(req, { action: "customer.update_self", entityType: "Customer", entityId: customerId, metadata: { fields: Object.keys(patch) } });
  return getOwnProfile(customerId);
}
