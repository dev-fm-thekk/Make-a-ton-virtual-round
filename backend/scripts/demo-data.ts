// Realistic demo data for UI work and presentations: customers, a catalog, subscriptions in every status,
// six months of invoices and payments (some overdue) so every screen and chart has something to show.
//
//   npm run demo:seed     create it   (refuses if demo data already exists)
//   npm run demo:clear    remove EXACTLY what demo:seed created (everything is tagged: "(demo)" names, @demo.test emails)
//
// Demo logins (password: Demo!Passw0rd1):  admin@demo.test · staff@demo.test · customer@demo.test

import { addDays, nextBillingDate, toDateOnly, todayUtc } from "../src/lib/dates.js";
import { lineAmounts, round2, sum, type Decimal } from "../src/lib/money.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/security.js";
import { nextDocumentNumber } from "../src/lib/shared.js";

const PASSWORD = "Demo!Passw0rd1";
const DOMAIN = "@demo.test";
const SUFFIX = " (demo)";
const today = todayUtc();

async function clear() {
  const customers = await prisma.customer.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const customerIds = customers.map((c) => c.id);
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const subs = await prisma.subscription.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const subIds = subs.map((s) => s.id);
  const invoices = await prisma.invoice.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const invoiceIds = invoices.map((i) => i.id);

  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.discountRedemption.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.subscription.deleteMany({ where: { id: { in: subIds } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: [...customerIds, ...subIds, ...userIds] } }] } });
  await prisma.quotationTemplate.deleteMany({ where: { name: { endsWith: SUFFIX } } });
  await prisma.plan.deleteMany({ where: { name: { endsWith: SUFFIX } } });
  await prisma.product.deleteMany({ where: { name: { endsWith: SUFFIX } } });
  await prisma.tax.deleteMany({ where: { name: { endsWith: SUFFIX } } });
  await prisma.paymentTerm.deleteMany({ where: { name: { endsWith: SUFFIX } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  console.log(`removed demo data: ${customerIds.length} customers, ${subIds.length} subscriptions, ${invoiceIds.length} invoices`);
}

async function seed() {
  if ((await prisma.user.count({ where: { email: { endsWith: DOMAIN } } })) > 0) {
    throw new Error("Demo data already exists. Run `npm run demo:clear` first.");
  }
  const hash = await hashPassword(PASSWORD);

  // ── people ──
  const mkUser = (e: string, name: string, role: "ADMIN" | "STAFF" | "CUSTOMER") => prisma.user.create({ data: { email: `${e}${DOMAIN}`, name, passwordHash: hash, role } });
  await mkUser("admin", "Demo Admin", "ADMIN");
  await mkUser("staff", "Demo Staff", "STAFF");
  const portalUser = await mkUser("customer", "Priya Nair", "CUSTOMER");

  const addr = (city: string) => ({ line1: "12 Market Road", city, state: "MH", postalCode: "411001", country: "India" });
  const customerData = [
    { key: "acme", name: "Priya Nair", companyName: "Acme Retail", email: `customer${DOMAIN}`, city: "Pune", userId: portalUser.id },
    { key: "bluesky", name: "Rahul Mehta", companyName: "BlueSky Logistics", email: `rahul${DOMAIN}`, city: "Mumbai" },
    { key: "orbit", name: "Sana Khan", companyName: "Orbit Labs", email: `sana${DOMAIN}`, city: "Bengaluru" },
    { key: "greenleaf", name: "Arjun Rao", companyName: "Greenleaf Foods", email: `arjun${DOMAIN}`, city: "Hyderabad" },
    { key: "nimbus", name: "Meera Iyer", companyName: "Nimbus Studio", email: `meera${DOMAIN}`, city: "Chennai" },
    { key: "kite", name: "Dev Patel", companyName: "Kite & Co", email: `dev${DOMAIN}`, city: "Ahmedabad" },
  ];
  const customers: Record<string, string> = {};
  for (const c of customerData) {
    customers[c.key] = (await prisma.customer.create({ data: { name: c.name, companyName: c.companyName, email: c.email, phone: "+91 98765 43210", billingAddress: addr(c.city), userId: c.userId ?? null } })).id;
  }

  // ── catalog ──
  const tax = await prisma.tax.create({ data: { name: `GST 18%${SUFFIX}`, ratePercent: 18 } });
  const term = (await prisma.paymentTerm.findFirst({ where: { dueDays: 15 } })) ?? (await prisma.paymentTerm.create({ data: { name: `Net 15${SUFFIX}`, dueDays: 15 } }));
  const prod = (name: string, price: number) => prisma.product.create({ data: { name: `${name}${SUFFIX}`, type: "SERVICE", salesPrice: price, costPrice: price * 0.4, taxId: tax.id } });
  const crm = await prod("CRM Suite", 1000);
  const support = await prod("Priority Support", 250);
  const analytics = await prod("Analytics Pack", 400);
  const odoo = await prisma.productVariant.create({ data: { productId: crm.id, attribute: "Brand", value: "Odoo", extraPrice: 560 } });
  await prisma.productVariant.create({ data: { productId: crm.id, attribute: "Brand", value: "Zoho", extraPrice: 320 } });

  const plan = (name: string, price: number, extra: object) => prisma.plan.create({ data: { name: `${name}${SUFFIX}`, price, billingPeriod: "MONTHLY", availableFrom: new Date("2024-01-01"), ...extra } });
  const monthly = await plan("Business Monthly", 1000, { minQuantity: 1, allowPause: true, allowRenewal: true, allowEarlyClose: true });
  const flex = await plan("Starter Flex", 400, { minQuantity: 1, allowPause: false, allowRenewal: false, allowEarlyClose: true });
  const yearly = await plan("Enterprise Yearly", 12000, { billingPeriod: "YEARLY", minQuantity: 5, allowPause: false, allowRenewal: true, allowEarlyClose: false });
  await prisma.quotationTemplate.create({
    data: { name: `Business starter pack${SUFFIX}`, planId: monthly.id, validityDays: 14, lines: { create: [{ productId: crm.id, variantId: odoo.id, quantity: 3 }, { productId: support.id, quantity: 1 }] } },
  });

  // ── subscriptions with invoices & payments ──
  type Spec = {
    cust: string; plan: { id: string; billingPeriod: "MONTHLY" | "YEARLY" }; status: "DRAFT" | "QUOTATION" | "CONFIRMED" | "ACTIVE" | "PAUSED" | "CLOSED";
    monthsAgo: number; lines: { product: { id: string }; variantId?: string; qty: number; unit: number }[]; unpaidLast?: number; closedAgo?: number; expiryInDays?: number;
  };
  const specs: Spec[] = [
    { cust: "acme", plan: monthly, status: "ACTIVE", monthsAgo: 6, lines: [{ product: crm, variantId: odoo.id, qty: 5, unit: 1560 }, { product: support, qty: 1, unit: 250 }], unpaidLast: 1 },
    { cust: "bluesky", plan: monthly, status: "ACTIVE", monthsAgo: 5, lines: [{ product: crm, qty: 3, unit: 1000 }], unpaidLast: 2 },
    { cust: "orbit", plan: yearly, status: "ACTIVE", monthsAgo: 3, lines: [{ product: crm, variantId: odoo.id, qty: 8, unit: 1560 }, { product: analytics, qty: 1, unit: 400 }] },
    { cust: "greenleaf", plan: monthly, status: "PAUSED", monthsAgo: 4, lines: [{ product: analytics, qty: 2, unit: 400 }] },
    { cust: "nimbus", plan: flex, status: "CLOSED", monthsAgo: 5, closedAgo: 1, lines: [{ product: support, qty: 2, unit: 250 }] },
    { cust: "kite", plan: monthly, status: "ACTIVE", monthsAgo: 2, lines: [{ product: analytics, qty: 4, unit: 400 }], expiryInDays: 60 },
    { cust: "acme", plan: flex, status: "CONFIRMED", monthsAgo: 0, lines: [{ product: analytics, qty: 1, unit: 400 }] },
    { cust: "orbit", plan: monthly, status: "QUOTATION", monthsAgo: 0, lines: [{ product: crm, qty: 2, unit: 1000 }] },
    { cust: "bluesky", plan: flex, status: "DRAFT", monthsAgo: 0, lines: [{ product: support, qty: 1, unit: 250 }] },
  ];

  let invCounter = 0;
  for (const [idx, s] of specs.entries()) {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - s.monthsAgo, 5 + (idx % 20)));
    const live = s.status === "ACTIVE" || s.status === "PAUSED";
    const period = s.plan.billingPeriod;
    const rows = s.lines.map((l, i) => ({ ...l, ...lineAmounts(l.qty, l.unit, 18), sortOrder: i }));
    const subtotal = sum(rows.map((r) => r.amount));
    const taxTotal = sum(rows.map((r) => r.tax));

    // billing dates from start up to today (monthly each month, yearly once a year)
    const periods: Date[] = [];
    if (live || s.status === "CLOSED") {
      const closedAt = s.closedAgo !== undefined ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - s.closedAgo, 10)) : null;
      for (let d: Date | null = start; d && d <= today && (!closedAt || d < closedAt); d = nextBillingDate(start, period, 1, d)) periods.push(d);
    }
    const next = live ? nextBillingDate(start, period, 1, periods.at(-1) ?? start) : null;

    await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.create({
        data: {
          number: await nextDocumentNumber(tx, "SUB"),
          customerId: customers[s.cust]!,
          planId: s.plan.id,
          paymentTermId: term.id,
          status: s.status,
          startDate: start,
          expiryDate: s.expiryInDays ? addDays(today, s.expiryInDays) : null,
          quoteValidUntil: s.status === "QUOTATION" ? addDays(today, 10) : null,
          nextBillingDate: next,
          activatedAt: live || s.status === "CLOSED" ? start : null,
          pausedAt: s.status === "PAUSED" ? addDays(today, -12) : null,
          closedAt: s.closedAgo !== undefined ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - s.closedAgo, 10)) : null,
          closeReason: s.status === "CLOSED" ? "Customer moved to another provider" : null,
          lines: { create: rows.map((r) => ({ productId: r.product.id, variantId: r.variantId ?? null, taxId: tax.id, description: "Demo line", quantity: r.qty, unitPrice: r.unit, amount: r.amount, sortOrder: r.sortOrder })) },
          statusHistory: { create: [{ fromStatus: null, toStatus: "DRAFT" }, ...(s.status !== "DRAFT" ? [{ fromStatus: "DRAFT" as const, toStatus: s.status }] : [])] },
        },
      });

      for (const [pi, periodStart] of periods.entries()) {
        const isLast = pi === periods.length - 1;
        const unpaid = s.unpaidLast !== undefined && pi >= periods.length - s.unpaidLast;
        const invoiceTotal: Decimal = round2(subtotal.plus(taxTotal));
        const issue = periodStart;
        const due = addDays(issue, term.dueDays);
        const paid = !unpaid && !(isLast && s.status === "PAUSED");
        const partial = unpaid && pi === periods.length - 1 && idx === 0; // one partly-paid invoice
        const paidAmount: Decimal = paid ? invoiceTotal : partial ? round2(invoiceTotal.dividedBy(4)) : round2(0);
        const periodEnd = addDays(nextBillingDate(start, period, 1, periodStart), -1);
        const number = `DEMO-INV-${String(++invCounter).padStart(5, "0")}`;
        const invoice = await tx.invoice.create({
          data: {
            number,
            subscriptionId: sub.id,
            customerId: sub.customerId,
            status: paid ? "PAID" : "CONFIRMED",
            periodStart,
            periodEnd,
            issueDate: issue,
            dueDate: due,
            subtotal,
            taxTotal,
            total: invoiceTotal,
            amountPaid: paidAmount,
            billToName: customerData.find((c) => customers[c.key] === sub.customerId)?.name ?? "Customer",
            billToEmail: `billing${DOMAIN}`,
            confirmedAt: issue,
            paidAt: paid ? addDays(issue, 3 + (idx % 6)) : null,
            lines: { create: rows.map((r) => ({ productId: r.product.id, variantId: r.variantId ?? null, description: "Demo line", quantity: r.qty, unitPrice: r.unit, taxRatePercent: 18, taxAmount: r.tax, lineTotal: r.total, sortOrder: r.sortOrder })) },
          },
        });
        if (paidAmount.greaterThan(0)) {
          const methods = ["BANK_TRANSFER", "UPI", "CARD", "CASH", "CHEQUE"] as const;
          await tx.payment.create({ data: { invoiceId: invoice.id, method: methods[(idx + pi) % methods.length]!, amount: paidAmount, paidAt: addDays(issue, 3 + (idx % 6)), reference: `REF-${invoice.number}` } });
        }
      }
    }, { timeout: 120_000, maxWait: 30_000 }); // many sequential round-trips over a remote DB
  }
  console.log(`demo data created (${specs.length} subscriptions, ${invCounter} invoices).\nLogins (password ${PASSWORD}): admin${DOMAIN}, staff${DOMAIN}, customer${DOMAIN}`);
  console.log(`today=${toDateOnly(today)}`);
}

const cmd = process.argv[2];
try {
  if (cmd === "clear") await clear();
  else if (cmd === "seed") await seed();
  else throw new Error("usage: demo-data.ts seed | clear");
} finally {
  await prisma.$disconnect();
}
