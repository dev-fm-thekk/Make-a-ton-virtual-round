// Performance check for the reporting endpoints against a REALISTIC volume (default: 20k subscriptions,
// ~95k invoices, ~65k payments). All data is inserted INSIDE one transaction that is ROLLED BACK at the end,
// so nothing persists and other developers never see it.
//
//   npx tsx --env-file=.env scripts/perf-reports.ts [subscriptions=20000]
//
// Target from the brief: every page responds in under 2 seconds. We print the best of 3 runs per endpoint,
// plus the connection round-trip so you can tell DB time from network time.

import { prisma } from "../src/lib/prisma.js";
import * as reports from "../src/modules/reports/reports.service.js";
import { invoicesQuery, overdueQuery, paymentsQuery, revenueQuery, subscriptionsReportQuery, summaryQuery } from "../src/modules/reports/reports.schemas.js";
import { addDays, toDateOnly, todayUtc } from "../src/lib/dates.js";

const N = Number(process.argv[2] ?? 20_000);
const CUSTOMERS = Math.max(100, Math.floor(N / 4));
class Rollback extends Error {}

const results: { name: string; ms: number }[] = [];

try {
  await prisma.$transaction(
    async (tx) => {
      const t0 = performance.now();
      await tx.$executeRawUnsafe(`INSERT INTO customers (id, name, email, "updatedAt")
        SELECT gen_random_uuid(), 'PERF Customer ' || g, 'perf' || g || '@perf.test', now() FROM generate_series(1, ${CUSTOMERS}) g`);
      await tx.$executeRawUnsafe(`INSERT INTO payment_terms (id, name, "dueDays", "updatedAt") VALUES (gen_random_uuid(), 'PERF Net15', 15, now())`);
      await tx.$executeRawUnsafe(`INSERT INTO taxes (id, name, "ratePercent", "updatedAt") VALUES (gen_random_uuid(), 'PERF GST', 18, now())`);
      await tx.$executeRawUnsafe(`INSERT INTO products (id, name, type, "salesPrice", "costPrice", "taxId", "updatedAt")
        SELECT gen_random_uuid(), 'PERF Product', 'SERVICE', 100, 40, id, now() FROM taxes WHERE name = 'PERF GST'`);
      await tx.$executeRawUnsafe(`INSERT INTO plans (id, name, price, "billingPeriod", "availableFrom", "updatedAt") VALUES
        (gen_random_uuid(), 'PERF Monthly', 100, 'MONTHLY', '2020-01-01', now()),
        (gen_random_uuid(), 'PERF Yearly', 1200, 'YEARLY', '2020-01-01', now()),
        (gen_random_uuid(), 'PERF Weekly', 30, 'WEEKLY', '2020-01-01', now())`);

      await tx.$executeRawUnsafe(`
        WITH c AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM customers WHERE email LIKE '%@perf.test'),
             p AS (SELECT id, row_number() OVER (ORDER BY name) rn FROM plans WHERE name LIKE 'PERF %')
        INSERT INTO subscriptions (id, number, "customerId", "planId", "paymentTermId", status, "startDate", "nextBillingDate", "activatedAt", "closedAt", "updatedAt")
        SELECT gen_random_uuid(), 'PERF-' || g, c.id, p.id, (SELECT id FROM payment_terms WHERE name = 'PERF Net15'),
               st::"SubscriptionStatus", current_date - (g % 400)::int,
               CASE WHEN st IN ('ACTIVE', 'PAUSED') THEN current_date + (g % 30)::int END,
               CASE WHEN st <> 'DRAFT' THEN now() - ((g % 400) || ' days')::interval END,
               CASE WHEN st = 'CLOSED' THEN now() - ((g % 60) || ' days')::interval END,
               now()
        FROM generate_series(1, ${N}) g
        CROSS JOIN LATERAL (SELECT CASE WHEN g % 20 < 12 THEN 'ACTIVE' WHEN g % 20 < 14 THEN 'PAUSED' WHEN g % 20 < 19 THEN 'CLOSED' ELSE 'DRAFT' END AS st) s
        JOIN c ON c.rn = 1 + (g % ${CUSTOMERS})
        JOIN p ON p.rn = 1 + (g % 3)`);

      await tx.$executeRawUnsafe(`
        INSERT INTO subscription_lines (id, "subscriptionId", "productId", "taxId", description, quantity, "unitPrice", amount, "updatedAt")
        SELECT gen_random_uuid(), s.id, pr.id, pr."taxId", 'PERF line', k + 1, 50 * k + 10, (k + 1) * (50 * k + 10), now()
        FROM subscriptions s CROSS JOIN generate_series(1, 2) k CROSS JOIN (SELECT id, "taxId" FROM products WHERE name = 'PERF Product') pr
        WHERE s.number LIKE 'PERF-%'`);

      await tx.$executeRawUnsafe(`
        INSERT INTO invoices (id, number, "subscriptionId", "customerId", status, "periodStart", "periodEnd", "issueDate", "dueDate",
                              subtotal, "taxTotal", total, "amountPaid", "billToName", "billToEmail", "updatedAt")
        SELECT gen_random_uuid(),
               CASE WHEN st <> 'DRAFT' THEN 'PERF-INV-' || row_number() OVER () END,
               s.id, s."customerId", st::"InvoiceStatus",
               current_date - (k * 30) - (n % 5)::int, current_date - (k * 30) - (n % 5)::int + 29, current_date - (k * 30) - (n % 5)::int, current_date - (k * 30) - (n % 5)::int + 15,
               tot, 0, tot,
               CASE WHEN st = 'PAID' THEN tot WHEN st = 'CONFIRMED' THEN (k % 2) * floor(tot / 4) ELSE 0 END,
               'PERF', 'perf@perf.test', now()
        FROM (SELECT s.*, row_number() OVER () AS n FROM subscriptions s WHERE s.number LIKE 'PERF-%' AND s.status <> 'DRAFT') s
        CROSS JOIN generate_series(1, 5) k
        CROSS JOIN LATERAL (SELECT CASE WHEN (s.n + k) % 20 < 14 THEN 'PAID' WHEN (s.n + k) % 20 < 19 THEN 'CONFIRMED' ELSE 'DRAFT' END AS st,
                                    (100 * k + (s.n % 50))::numeric AS tot) x`);

      await tx.$executeRawUnsafe(`
        INSERT INTO payments (id, "invoiceId", method, amount, "paidAt")
        SELECT gen_random_uuid(), i.id, (ARRAY['CASH','BANK_TRANSFER','CARD','UPI','CHEQUE'])[1 + (row_number() OVER ())::int % 5]::"PaymentMethod",
               i."amountPaid", i."issueDate"::timestamp AT TIME ZONE 'UTC' + interval '3 days'
        FROM invoices i WHERE i."amountPaid" > 0 AND i.number LIKE 'PERF-INV-%'`);

      for (const t of ["customers", "subscriptions", "subscription_lines", "invoices", "payments"]) await tx.$executeRawUnsafe(`ANALYZE "${t}"`);

      const [counts] = await tx.$queryRawUnsafe<{ subs: number; inv: number; pay: number }[]>(
        `SELECT (SELECT count(*) FROM subscriptions)::int subs, (SELECT count(*) FROM invoices)::int inv, (SELECT count(*) FROM payments)::int pay`,
      );
      console.log(`seeded in ${((performance.now() - t0) / 1000).toFixed(1)}s →`, counts);

      // network floor: one trivial round trip
      const rtt = await time(() => tx.$queryRawUnsafe(`SELECT 1`), 5);
      console.log(`round-trip floor: ${rtt.toFixed(0)} ms per query (network, not the database)\n`);

      const today = todayUtc();
      const from5y = toDateOnly(addDays(today, -365 * 2));
      const T = toDateOnly(today);
      const cust = (await tx.customer.findFirstOrThrow({ where: { email: { endsWith: "@perf.test" } }, select: { id: true } })).id;

      const run = (name: string, fn: () => Promise<unknown>) => time(fn).then((ms) => results.push({ name, ms }));
      await run("summary (this month)", () => reports.summary(summaryQuery.parse({}), tx));
      await run("summary (2 years)", () => reports.summary(summaryQuery.parse({ from: from5y, to: T }), tx));
      await run("revenue (12 months, by month)", () => reports.revenueSeries(revenueQuery.parse({ from: toDateOnly(addDays(today, -365)), to: T, groupBy: "month" }), tx));
      await run("revenue (90 days, by day)", () => reports.revenueSeries(revenueQuery.parse({ from: toDateOnly(addDays(today, -90)), to: T, groupBy: "day" }), tx));
      await run("overdue (page 1)", () => reports.overdue(overdueQuery.parse({}), tx));
      await run("overdue (deep page 50)", () => reports.overdue(overdueQuery.parse({ page: "50" }), tx));
      await run("invoices state=all", () => reports.invoices(invoicesQuery.parse({}), tx));
      await run("invoices state=outstanding", () => reports.invoices(invoicesQuery.parse({ state: "outstanding" }), tx));
      await run("invoices state=paid + date range", () => reports.invoices(invoicesQuery.parse({ state: "paid", from: toDateOnly(addDays(today, -60)), to: T }), tx));
      await run("invoices search by number", () => reports.invoices(invoicesQuery.parse({ search: "PERF-INV-5000" }), tx));
      await run("invoices for one customer", () => reports.invoices(invoicesQuery.parse({ customerId: cust }), tx));
      await run("payments (all, page 1)", () => reports.payments(paymentsQuery.parse({}), tx));
      await run("payments method=UPI + range", () => reports.payments(paymentsQuery.parse({ method: "UPI", from: toDateOnly(addDays(today, -90)), to: T }), tx));
      await run("subscriptions report (by MRR)", () => reports.subscriptionsReport(subscriptionsReportQuery.parse({}), tx));
      await run("subscriptions report ACTIVE deep page", () => reports.subscriptionsReport(subscriptionsReportQuery.parse({ status: "ACTIVE", page: "100" }), tx));

      throw new Rollback(); // never commit the synthetic data
    },
    { timeout: 540_000, maxWait: 60_000 },
  );
} catch (e) {
  if (!(e instanceof Rollback)) throw e;
}

console.log("endpoint".padEnd(42), "best of 3");
let worst = 0;
for (const r of results) {
  worst = Math.max(worst, r.ms);
  console.log(r.name.padEnd(42), `${r.ms.toFixed(0).padStart(6)} ms`, r.ms > 2000 ? "  ✗ OVER 2s" : "");
}
console.log(`\nslowest: ${worst.toFixed(0)} ms (budget 2000 ms)`);

const left = await prisma.customer.count({ where: { email: { endsWith: "@perf.test" } } });
console.log(left === 0 ? "rolled back: no synthetic rows remain ✓" : `WARNING: ${left} synthetic customers remain!`);
await prisma.$disconnect();
process.exit(worst > 2000 ? 1 : 0);

async function time(fn: () => Promise<unknown>, runs = 3) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    await fn();
    best = Math.min(best, performance.now() - s);
  }
  return best;
}
