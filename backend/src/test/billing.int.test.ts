import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, nextBillingDate, toDateOnly, todayUtc } from "../lib/dates.js";
import { prisma } from "../lib/prisma.js";
import { createRun } from "../modules/billing/billing.service.js";
import { runScheduledBillingOnce } from "../modules/billing/scheduler.js";
import { executeRun, type RunSummary } from "../modules/billing/engine.js";
import { baseUrl, call, cleanup, createStaffUser, disconnect, get, patch, post, registerCustomer, startServer, stopServer, TAG } from "./harness.js";

const today = todayUtc();
const T = toDateOnly(today);

let admin: Awaited<ReturnType<typeof createStaffUser>>;
let staff: Awaited<ReturnType<typeof createStaffUser>>;
let custA: Awaited<ReturnType<typeof registerCustomer>>;
let custB: Awaited<ReturnType<typeof registerCustomer>>;
let termId: string, taxId: string, planM: string;
let P1: string, P2: string, P3: string, P4: string;

const name = (s: string) => `ZZT ${TAG} ${s}`;
let subCounter = 0;

async function mkSub(o: { customer: string; lines: { productId: string; qty: number; unit: number }[]; start?: Date; next?: Date | null; expiry?: Date | null; status?: "ACTIVE" | "PAUSED" | "CLOSED" | "DRAFT" | "CONFIRMED" }) {
  const status = o.status ?? "ACTIVE";
  const live = status === "ACTIVE" || status === "PAUSED";
  const start = o.start ?? today;
  return prisma.subscription.create({
    data: {
      number: `ZZT-${TAG}-${++subCounter}`,
      customerId: o.customer,
      planId: planM,
      paymentTermId: termId,
      status,
      startDate: start,
      expiryDate: o.expiry ?? null,
      nextBillingDate: live ? (o.next === undefined ? start : o.next) : null,
      activatedAt: live ? new Date() : null,
      lines: { create: o.lines.map((l, i) => ({ productId: l.productId, taxId, description: `Line ${i + 1}`, quantity: l.qty, unitPrice: l.unit, amount: l.qty * l.unit, sortOrder: i })) },
    },
    include: { lines: true },
  });
}

/** Run the engine for exactly these subscriptions (never touches anybody else's data in a shared database). */
async function bill(ids: string[], opts: { concurrency?: number; autoConfirm?: boolean } = {}): Promise<{ runId: string; summary: RunSummary }> {
  const run = await prisma.billingRun.create({ data: { runDate: today, status: "RUNNING", triggeredBy: admin.userId } });
  const summary = await executeRun(run.id, { asOf: today, autoConfirm: opts.autoConfirm ?? false, concurrency: opts.concurrency ?? 1, maxInvoices: 100, only: ids });
  return { runId: run.id, summary };
}

const invoicesOf = (subscriptionId: string) => prisma.invoice.findMany({ where: { subscriptionId }, orderBy: { periodStart: "asc" }, include: { lines: true } });
const subRow = (id: string) => prisma.subscription.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await cleanup();
  await startServer();
  admin = await createStaffUser("admin", "ADMIN");
  staff = await createStaffUser("staff", "STAFF");
  custA = await registerCustomer("custA");
  custB = await registerCustomer("custB");
  // user-supplied text that must stay inert on invoices and in print output
  await prisma.customer.update({ where: { id: custA.customerId }, data: { companyName: `${TAG} <img src=x onerror=alert(1)>`, taxId: "GSTIN-123", billingAddress: { line1: "1 Main St", city: "Pune", postalCode: "411001", country: "India" } } });

  termId = (await prisma.paymentTerm.create({ data: { name: name("Net10"), dueDays: 10 } })).id;
  taxId = (await prisma.tax.create({ data: { name: name("GST18"), ratePercent: 18 } })).id;
  planM = (await prisma.plan.create({ data: { name: name("Monthly"), price: 1000, billingPeriod: "MONTHLY", availableFrom: new Date("2020-01-01") } })).id;
  const prod = async (n: string) => (await prisma.product.create({ data: { name: name(n), type: "SERVICE", salesPrice: 1000, costPrice: 400, taxId } })).id;
  [P1, P2, P3, P4] = [await prod("P1 plain"), await prod("P2 pct-discounted"), await prod("P3 limited-discount"), await prod("P4 dead-discounts")];
});

afterAll(async () => {
  await cleanup();
  await stopServer();
  await disconnect();
});

// ═════════════════════════ the engine ═════════════════════════
describe("billing engine", () => {
  let subA: Awaited<ReturnType<typeof mkSub>>;
  let firstRun: string;

  it("turns a due subscription into a draft invoice with snapshot, tax and due date", async () => {
    subA = await mkSub({ customer: custA.customerId, lines: [{ productId: P1, qty: 2, unit: 1560 }] });
    const { runId, summary } = await bill([subA.id]);
    firstRun = runId;
    expect(summary).toMatchObject({ scanned: 1, invoiced: 1, skipped: 0, failed: 0, total: "3681.60" });

    const [inv] = await invoicesOf(subA.id);
    expect(inv).toMatchObject({ status: "DRAFT", number: null, billingRunId: runId, currency: "INR" });
    expect(inv!.subtotal.toFixed(2)).toBe("3120.00");
    expect(inv!.taxTotal.toFixed(2)).toBe("561.60");
    expect(inv!.total.toFixed(2)).toBe("3681.60");
    expect(toDateOnly(inv!.periodStart)).toBe(T);
    expect(toDateOnly(inv!.issueDate)).toBe(T);
    expect(toDateOnly(inv!.dueDate)).toBe(toDateOnly(addDays(today, 10))); // payment term
    expect(inv!.billToName).toContain("<img"); // snapshot of the customer's company name, stored verbatim
    expect(inv!.billToTaxId).toBe("GSTIN-123");
    expect(inv!.lines).toHaveLength(1);
    expect(inv!.lines[0]).toMatchObject({ quantity: 2, description: "Line 1" });
    expect(inv!.lines[0]!.lineTotal.toFixed(2)).toBe("3681.60");
  });

  it("moves the schedule forward in the same transaction, and the run is recorded", async () => {
    const s = await subRow(subA.id);
    expect(toDateOnly(s.nextBillingDate!)).toBe(toDateOnly(nextBillingDate(today, "MONTHLY", 1, today)));
    const run = await prisma.billingRun.findUniqueOrThrow({ where: { id: firstRun } });
    expect(run).toMatchObject({ status: "COMPLETED", scanned: 1, invoiced: 1, failed: 0 });
    expect(run.finishedAt).toBeTruthy();
  });

  it("is idempotent: running again bills nothing", async () => {
    const { summary } = await bill([subA.id]);
    expect(summary).toMatchObject({ scanned: 0, invoiced: 0 });
    expect(await invoicesOf(subA.id)).toHaveLength(1);
  });

  it("never double-bills a period, even when the schedule is wound back (it just skips and moves on)", async () => {
    await prisma.subscription.update({ where: { id: subA.id }, data: { nextBillingDate: today } });
    const { summary } = await bill([subA.id]);
    expect(summary).toMatchObject({ scanned: 1, invoiced: 0, skipped: 1 });
    expect(await invoicesOf(subA.id)).toHaveLength(1);
    expect(toDateOnly((await subRow(subA.id)).nextBillingDate!)).toBe(toDateOnly(nextBillingDate(today, "MONTHLY", 1, today)));
  });

  it("the database refuses a duplicate period even if the application tried", async () => {
    const [inv] = await invoicesOf(subA.id);
    await expect(
      prisma.invoice.create({
        data: { subscriptionId: subA.id, customerId: custA.customerId, status: "DRAFT", periodStart: inv!.periodStart, periodEnd: inv!.periodEnd, issueDate: today, dueDate: today, subtotal: 0, taxTotal: 0, total: 0, billToName: "x", billToEmail: "x@example.test" },
      }),
    ).rejects.toThrow(/Unique constraint|unique/i);
  });

  it("catches up late subscriptions period by period, one invoice per period", async () => {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1));
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 100 }], start, next: start });
    const { summary } = await bill([sub.id]);
    expect(summary.invoiced).toBe(4); // 3 months ago, 2, 1, and this month
    const invs = await invoicesOf(sub.id);
    expect(invs.map((i) => toDateOnly(i.periodStart))).toEqual([-3, -2, -1, 0].map((k) => toDateOnly(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k, 1)))));
    expect(new Set(invs.map((i) => toDateOnly(i.issueDate)))).toEqual(new Set([T])); // late invoices are issued today
    expect(toDateOnly((await subRow(sub.id)).nextBillingDate!)).toBe(toDateOnly(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))));
  });

  it("two workers on the same subscriptions never produce duplicates (6 subs, 2 parallel runs)", async () => {
    const subs = await Promise.all(Array.from({ length: 6 }, () => mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 50 }] })));
    const ids = subs.map((s) => s.id);
    const [a, b] = await Promise.all([bill(ids, { concurrency: 2 }), bill(ids, { concurrency: 2 })]);
    expect(a.summary.invoiced + b.summary.invoiced).toBe(6);
    expect(a.summary.failed + b.summary.failed).toBe(0);
    const all = await prisma.invoice.findMany({ where: { subscriptionId: { in: ids } } });
    expect(all).toHaveLength(6);
    expect(new Set(all.map((i) => i.subscriptionId)).size).toBe(6);
  });

  it("only bills ACTIVE subscriptions that are due", async () => {
    const [paused, closed, future, draft] = await Promise.all([
      mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }], status: "PAUSED" }),
      mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }], status: "CLOSED" }),
      mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }], next: addDays(today, 3) }),
      mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }], status: "DRAFT" }),
    ]);
    const { summary } = await bill([paused.id, closed.id, future.id, draft.id]);
    expect(summary.scanned).toBe(0);
  });

  it("clamps the last period to the expiry date and stops scheduling", async () => {
    const start = addDays(today, -15);
    const expiry = addDays(today, 5);
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 100 }], start, next: start, expiry });
    const { summary } = await bill([sub.id]);
    expect(summary.invoiced).toBe(1);
    const [inv] = await invoicesOf(sub.id);
    expect(toDateOnly(inv!.periodEnd)).toBe(toDateOnly(expiry)); // not a day beyond the subscription's end
    expect((await subRow(sub.id)).nextBillingDate).toBeNull();
  });

  it("one failing subscription is recorded and does not stop the others", async () => {
    const good = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }] });
    const bad = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }] });
    await prisma.subscriptionLine.deleteMany({ where: { subscriptionId: bad.id } }); // nothing to bill → engine refuses it
    const { runId, summary } = await bill([good.id, bad.id]);
    expect(summary).toMatchObject({ invoiced: 1, failed: 1 });
    expect(summary.errors[0]).toMatchObject({ subscription: bad.number });
    const run = await prisma.billingRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("PARTIAL");
    expect((await subRow(bad.id)).nextBillingDate).not.toBeNull(); // still due: it will be retried next run
    expect(await invoicesOf(bad.id)).toHaveLength(0);
  });
});

// ═════════════════════════ discounts in the engine ═════════════════════════
describe("discounts at billing time", () => {
  const mkDiscount = (o: Record<string, unknown>) => prisma.discount.create({ data: { name: name("disc"), type: "PERCENTAGE", value: 10, scope: "PRODUCT", startDate: new Date("2020-01-01"), ...o } as never });

  it("applies a live product discount automatically and records the redemption", async () => {
    const d = await mkDiscount({ type: "PERCENTAGE", value: 10, products: { create: [{ productId: P2 }] } });
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P2, qty: 1, unit: 1000 }] });
    await bill([sub.id]);
    const [inv] = await invoicesOf(sub.id);
    expect(inv!.discountTotal.toFixed(2)).toBe("100.00");
    expect(inv!.taxTotal.toFixed(2)).toBe("162.00"); // tax is on the discounted 900
    expect(inv!.total.toFixed(2)).toBe("1062.00");
    expect(inv!.lines[0]!.discountAmount.toFixed(2)).toBe("100.00");
    expect(await prisma.discountRedemption.count({ where: { discountId: d.id, invoiceId: inv!.id } })).toBe(1);
    expect((await prisma.discount.findUniqueOrThrow({ where: { id: d.id } })).usedCount).toBe(1);

    // cancelling the unpaid invoice gives the use back
    const r = await post(`/invoices/${inv!.id}/cancel`, { reason: "test" }, staff.token);
    expect(r.status).toBe(200);
    expect((await prisma.discount.findUniqueOrThrow({ where: { id: d.id } })).usedCount).toBe(0);
    expect(await prisma.discountRedemption.count({ where: { invoiceId: inv!.id } })).toBe(0);
  });

  it("a limited discount is honoured under concurrency: with 1 use left, exactly one of 3 invoices gets it", async () => {
    const d = await mkDiscount({ type: "FIXED", value: 50, usageLimit: 1, products: { create: [{ productId: P3 }] } });
    const subs = await Promise.all([1, 2, 3].map(() => mkSub({ customer: custB.customerId, lines: [{ productId: P3, qty: 1, unit: 400 }] })));
    const { summary } = await bill(subs.map((s) => s.id), { concurrency: 3 });
    expect(summary).toMatchObject({ invoiced: 3, failed: 0 });
    const invs = (await Promise.all(subs.map((s) => invoicesOf(s.id)))).flat();
    expect(invs.filter((i) => i.discountTotal.greaterThan(0))).toHaveLength(1);
    expect(invs.filter((i) => i.discountTotal.equals(0))).toHaveLength(2);
    expect((await prisma.discount.findUniqueOrThrow({ where: { id: d.id } })).usedCount).toBe(1); // never over the limit
    expect(await prisma.discountRedemption.count({ where: { discountId: d.id } })).toBe(1);
  });

  it("a subscription-level discount needs its minimum purchase", async () => {
    const d = await mkDiscount({ type: "FIXED", value: 25, scope: "SUBSCRIPTION", minPurchaseAmount: 1000 });
    const big = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 1500 }] });
    const small = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 500 }] });
    await prisma.subscriptionDiscount.createMany({ data: [{ subscriptionId: big.id, discountId: d.id }, { subscriptionId: small.id, discountId: d.id }] });
    await bill([big.id, small.id]);
    expect((await invoicesOf(big.id))[0]!.discountTotal.toFixed(2)).toBe("25.00");
    expect((await invoicesOf(small.id))[0]!.discountTotal.toFixed(2)).toBe("0.00");
  });

  it("expired, not-yet-started, inactive and deleted discounts are ignored", async () => {
    const links = { products: { create: [{ productId: P4 }] } };
    await mkDiscount({ endDate: addDays(today, -1), ...links });
    await mkDiscount({ startDate: addDays(today, 1), ...links });
    await mkDiscount({ isActive: false, ...links });
    await mkDiscount({ deletedAt: new Date(), ...links });
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P4, qty: 1, unit: 200 }] });
    await bill([sub.id]);
    expect((await invoicesOf(sub.id))[0]!.discountTotal.toFixed(2)).toBe("0.00");
  });

  it("a 100% discount makes a zero invoice that settles itself on confirm", async () => {
    const P5 = (await prisma.product.create({ data: { name: name("P5 free"), type: "SERVICE", salesPrice: 100, costPrice: 1, taxId } })).id;
    await mkDiscount({ value: 100, products: { create: [{ productId: P5 }] } });
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P5, qty: 1, unit: 100 }] });
    await bill([sub.id]);
    const [inv] = await invoicesOf(sub.id);
    expect(inv!.total.toFixed(2)).toBe("0.00");
    const r = await post(`/invoices/${inv!.id}/confirm`, undefined, staff.token);
    expect(r.body.invoice).toMatchObject({ status: "PAID", paymentState: "paid", balance: "0.00" });
    expect(r.body.invoice.number).toMatch(/^INV-\d{4}-\d{6}$/);
  });
});

// ═════════════════════════ billing API ═════════════════════════
describe("billing API", () => {
  it("previews what is due", async () => {
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 2, unit: 100 }] });
    const r = await get("/billing/preview", staff.token);
    expect(r.status).toBe(200);
    expect(r.body.dueSubscriptions).toBeGreaterThanOrEqual(1);
    expect(Number(r.body.estimatedTotal)).toBeGreaterThanOrEqual(236); // this subscription alone: 200 + 18% tax
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CLOSED", nextBillingDate: null } }); // keep it out of later runs
  });

  it("only admins can start a run; staff can read runs", async () => {
    expect((await post("/billing/run", {}, staff.token)).status).toBe(403);
    expect((await post("/billing/run", {}, custA.token)).status).toBe(403);
    expect((await get("/billing/runs", staff.token)).status).toBe(200);
    expect((await get("/billing/runs", custA.token)).status).toBe(403);
  });

  it("rejects billing the future", async () => {
    const r = await post("/billing/run", { asOf: toDateOnly(addDays(today, 2)), subscriptionId: "00000000-0000-4000-8000-000000000000" }, admin.token);
    expect(r.status).toBe(400);
  });

  it("runs for one subscription via the API and exposes the finished run", async () => {
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 100 }] });
    const r = await call("POST", "/billing/run?wait=true", { token: admin.token, body: { subscriptionId: sub.id, autoConfirm: true } });
    expect(r.status).toBe(200);
    expect(r.body.run).toMatchObject({ status: "COMPLETED", invoiced: 1, confirmed: 1, invoicedTotal: "118.00" });
    const detail = await get(`/billing/runs/${r.body.run.id}`, staff.token);
    expect(detail.body.run.id).toBe(r.body.run.id);
    const inv = await invoicesOf(sub.id);
    expect(inv[0]!.status).toBe("CONFIRMED");
    expect(inv[0]!.number).toMatch(/^INV-\d{4}-\d{6}$/);
  });

  it("refuses a second full run while one is in progress, and recovers from a crashed one", async () => {
    const live = await prisma.billingRun.create({ data: { runDate: today, status: "RUNNING", triggeredBy: admin.userId } });
    await expect(createRun({ triggeredBy: admin.userId })).rejects.toMatchObject({ code: "RUN_IN_PROGRESS" });

    await prisma.billingRun.update({ where: { id: live.id }, data: { startedAt: new Date(Date.now() - 31 * 60_000) } }); // looks crashed
    const fresh = await createRun({ triggeredBy: admin.userId });
    expect(fresh).not.toBeNull();
    expect((await prisma.billingRun.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("FAILED");
    await prisma.billingRun.update({ where: { id: fresh!.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
  });

  it("lets only one instance claim the daily scheduler run", async () => {
    const asOf = new Date("2000-01-03T00:00:00Z"); // a date no real run will ever use
    const first = await createRun({ triggeredBy: "scheduler", asOf });
    const second = await createRun({ triggeredBy: "scheduler", asOf });
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // the loser stands down
    await prisma.billingRun.update({ where: { id: first!.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
  });
});

// ═════════════════════════ invoices ═════════════════════════
describe("invoices", () => {
  let draft: { id: string };
  let draftB: { id: string };

  beforeAll(async () => {
    const a = await mkSub({ customer: custA.customerId, lines: [{ productId: P1, qty: 1, unit: 1000 }] });
    const b = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 700 }] });
    await bill([a.id, b.id]);
    draft = (await invoicesOf(a.id))[0]!;
    draftB = (await invoicesOf(b.id))[0]!;
  });

  it("customers never see drafts; staff do", async () => {
    expect((await get(`/invoices/${draft.id}`, custA.token)).status).toBe(404);
    const s = await get(`/invoices/${draft.id}`, staff.token);
    expect(s.status).toBe(200);
    expect(s.body.invoice).toMatchObject({ status: "DRAFT", paymentState: "draft", number: null, availableActions: ["confirm", "cancel"] });
    expect(s.body.invoice.total).toBe("1180.00");
  });

  it("confirming assigns a gap-free sequential number and can't be repeated", async () => {
    const r1 = await post(`/invoices/${draft.id}/confirm`, undefined, staff.token);
    expect(r1.status).toBe(200);
    expect(r1.body.invoice).toMatchObject({ status: "CONFIRMED", paymentState: "outstanding", balance: "1180.00" });
    expect(r1.body.invoice.availableActions).toEqual(["send", "record_payment", "cancel"]);
    const n1 = r1.body.invoice.number as string;
    expect(n1).toMatch(/^INV-\d{4}-\d{6}$/);

    const again = await post(`/invoices/${draft.id}/confirm`, undefined, staff.token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");

    const r2 = await post(`/invoices/${draftB.id}/confirm`, undefined, staff.token);
    expect(r2.body.invoice.number > n1).toBe(true);
  });

  it("two simultaneous confirms of the same invoice: one wins, no number is wasted twice", async () => {
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }] });
    await bill([sub.id]);
    const inv = (await invoicesOf(sub.id))[0]!;
    const [a, b] = await Promise.all([post(`/invoices/${inv.id}/confirm`, undefined, staff.token), post(`/invoices/${inv.id}/confirm`, undefined, staff.token)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("customers see their own issued invoices, scoped in the query", async () => {
    const mine = await get("/invoices", custA.token);
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThanOrEqual(1);
    expect(mine.body.items.every((i: any) => i.customer.id === custA.customerId && ["CONFIRMED", "PAID"].includes(i.status))).toBe(true);
    const spoof = await get(`/invoices?customerId=${custB.customerId}&status=DRAFT`, custA.token);
    expect(spoof.body.items.every((i: any) => i.customer.id === custA.customerId && i.status !== "DRAFT")).toBe(true);
    expect((await get(`/invoices/${draftB.id}`, custA.token)).status).toBe(404); // someone else's
  });

  it("staff filter by run, status, search and overdue, with totals over the whole set", async () => {
    const byRun = await get(`/invoices?billingRunId=${(await prisma.invoice.findUniqueOrThrow({ where: { id: draft.id } })).billingRunId}&status=CONFIRMED`, staff.token);
    expect(byRun.body.items.length).toBe(2);
    expect(byRun.body.totals).toMatchObject({ invoices: 2, total: "2006.00", balance: "2006.00" });
    const number = (await get(`/invoices/${draft.id}`, staff.token)).body.invoice.number;
    expect((await get(`/invoices?search=${number}`, staff.token)).body.items.map((i: any) => i.id)).toEqual([draft.id]);
    expect((await get("/invoices?status=NOPE", staff.token)).status).toBe(400);
    const past = await prisma.subscription.create({ data: { number: `ZZT-${TAG}-ovd`, customerId: custA.customerId, planId: planM, paymentTermId: termId, status: "CLOSED", startDate: today } });
    const overdueInv = await prisma.invoice.create({
      data: { subscriptionId: past.id, customerId: custA.customerId, number: `ZZT-INV-${TAG}`, status: "CONFIRMED", confirmedAt: new Date(), periodStart: addDays(today, -60), periodEnd: addDays(today, -31), issueDate: addDays(today, -50), dueDate: addDays(today, -40), subtotal: 100, taxTotal: 0, total: 100, billToName: "x", billToEmail: "x@example.test" },
    });
    const od = await get(`/invoices?overdue=true&customerId=${custA.customerId}`, staff.token);
    expect(od.body.items.map((i: any) => i.id)).toEqual([overdueInv.id]);
    expect(od.body.items[0]).toMatchObject({ paymentState: "overdue", balance: "100.00" });
  });

  it("send: refuses drafts, emails issued invoices and stamps sentAt", async () => {
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }] });
    await bill([sub.id]);
    const inv = (await invoicesOf(sub.id))[0]!;
    expect((await post(`/invoices/${inv.id}/send`, undefined, staff.token)).body.error.code).toBe("NOT_CONFIRMED");
    await post(`/invoices/${inv.id}/confirm`, undefined, staff.token);
    const r = await post(`/invoices/${inv.id}/send`, undefined, staff.token);
    expect(r.status).toBe(200);
    expect(r.body.invoice.sentAt).toBeTruthy();
    expect((await post(`/invoices/${inv.id}/send`, undefined, custB.token)).status).toBe(403);
  });

  it("print renders safe HTML for staff and for the owner only", async () => {
    const r = await fetchHtml(`/invoices/${draft.id}/print`, staff.token);
    expect(r.status).toBe(200);
    expect(r.type).toContain("text/html");
    expect(r.text).toContain("INV-");
    expect(r.text).not.toContain("<img src=x"); // the customer's company name is escaped
    expect(r.text).toContain("&lt;img src=x");
    expect((await fetchHtml(`/invoices/${draft.id}/print`, custA.token)).status).toBe(200);
    expect((await fetchHtml(`/invoices/${draft.id}/print`, custB.token)).status).toBe(404);
  });

  it("bulk confirm handles a whole run and survives bad ids", async () => {
    const subs = await Promise.all([1, 2, 3].map(() => mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }] })));
    const { runId } = await bill(subs.map((s) => s.id));
    const r = await post("/invoices/bulk-confirm", { billingRunId: runId }, staff.token);
    expect(r.body).toMatchObject({ confirmed: 3, failed: [], more: false });
    const again = await post("/invoices/bulk-confirm", { billingRunId: runId }, staff.token); // nothing left in draft
    expect(again.body.confirmed).toBe(0);
    expect((await post("/invoices/bulk-confirm", {}, staff.token)).status).toBe(400);
    expect((await post("/invoices/bulk-confirm", { ids: [], billingRunId: runId }, staff.token)).status).toBe(400);
  });

  it("cancel needs a reason, keeps an audit trail, and a cancelled period can be reissued by an admin", async () => {
    const sub = await mkSub({ customer: custB.customerId, lines: [{ productId: P1, qty: 1, unit: 300 }] });
    await bill([sub.id]);
    const inv = (await invoicesOf(sub.id))[0]!;
    expect((await post(`/invoices/${inv.id}/cancel`, {}, staff.token)).status).toBe(400);
    const c = await post(`/invoices/${inv.id}/cancel`, { reason: "wrong plan" }, staff.token);
    expect(c.body.invoice).toMatchObject({ status: "CANCELLED", balance: "0.00", availableActions: [] });
    expect(c.body.invoice.notes).toContain("Cancelled: wrong plan");

    expect((await post(`/invoices/${inv.id}/reissue`, undefined, staff.token)).status).toBe(403); // admin only
    const re = await post(`/invoices/${inv.id}/reissue`, undefined, admin.token);
    expect(re.status).toBe(201);
    expect(re.body.invoice).toMatchObject({ status: "DRAFT", total: "354.00", periodStart: toDateOnly(inv.periodStart) });
    expect(re.body.invoice.id).not.toBe(inv.id);
    expect((await post(`/invoices/${inv.id}/reissue`, undefined, admin.token)).body.error.code).toBe("PERIOD_ALREADY_INVOICED");
    expect((await post(`/invoices/${re.body.invoice.id}/reissue`, undefined, admin.token)).body.error.code).toBe("INVALID_TRANSITION");
  });
});

// ═════════════════════════ payments ═════════════════════════
describe("payments", () => {
  async function confirmedInvoice(unit: number, customer = custA.customerId) {
    const sub = await mkSub({ customer, lines: [{ productId: P1, qty: 1, unit }] });
    await bill([sub.id]);
    const inv = (await invoicesOf(sub.id))[0]!;
    await post(`/invoices/${inv.id}/confirm`, undefined, staff.token);
    return inv.id;
  }
  const pay = (id: string, body: object, token = staff.token, key?: string) =>
    call("POST", `/invoices/${id}/payments`, { token, body, headers: key ? { "idempotency-key": key } : undefined });

  it("records partial then final payments and settles the invoice", async () => {
    const id = await confirmedInvoice(100); // total 118.00
    const p1 = await pay(id, { method: "CASH", amount: "50.00", reference: "R-1", note: "first" });
    expect(p1.status).toBe(201);
    expect(p1.body.invoice).toMatchObject({ status: "CONFIRMED", amountPaid: "50.00", balance: "68.00" });
    expect(p1.body.payment).toMatchObject({ method: "CASH", amount: "50.00", reference: "R-1", note: "first" });

    const p2 = await pay(id, { method: "UPI", amount: 68 });
    expect(p2.body.invoice).toMatchObject({ status: "PAID", amountPaid: "118.00", balance: "0.00" });
    expect(p2.body.invoice.paidAt).toBeTruthy();

    const list = await get(`/invoices/${id}/payments`, staff.token);
    expect(list.body.items.map((p: any) => p.amount)).toEqual(["50.00", "68.00"]);
    const detail = await get(`/invoices/${id}`, staff.token);
    expect(detail.body.invoice).toMatchObject({ status: "PAID", paymentState: "paid", availableActions: ["send"] });
    expect(detail.body.invoice.payments).toHaveLength(2);
  });

  it("refuses overpayment, junk amounts, bad dates and the wrong states", async () => {
    const id = await confirmedInvoice(100);
    const over = await pay(id, { method: "CASH", amount: "118.01" });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: "OVERPAYMENT", details: { balance: "118.00" } });
    for (const amount of ["0", "-5", "10.123", "abc", ""]) expect((await pay(id, { method: "CASH", amount })).status).toBe(400);
    expect((await pay(id, { method: "BITCOIN", amount: "1" })).status).toBe(400);
    expect((await pay(id, { method: "CASH", amount: "1", paidAt: new Date(Date.now() + 3_600_000).toISOString() })).status).toBe(400); // future
    expect((await pay(id, { method: "CASH", amount: "1", paidAt: "2001-01-01" })).status).toBe(400); // before the invoice existed

    // wrong state
    const sub = await mkSub({ customer: custA.customerId, lines: [{ productId: P1, qty: 1, unit: 10 }] });
    await bill([sub.id]);
    const draftId = (await invoicesOf(sub.id))[0]!.id;
    expect((await pay(draftId, { method: "CASH", amount: "1" })).body.error.code).toBe("NOT_CONFIRMED");
    await pay(id, { method: "CASH", amount: "118.00" });
    expect((await pay(id, { method: "CASH", amount: "1" })).body.error.code).toBe("ALREADY_PAID");
    await post(`/invoices/${draftId}/cancel`, { reason: "x" }, staff.token);
    expect((await pay(draftId, { method: "CASH", amount: "1" })).body.error.code).toBe("INVALID_TRANSITION");
  });

  it("only staff record money; customers can read their own payments, not others'", async () => {
    const id = await confirmedInvoice(100);
    await pay(id, { method: "CARD", amount: "10.00", note: "internal" });
    expect((await pay(id, { method: "CASH", amount: "1" }, custA.token)).status).toBe(403);
    const mine = await get(`/invoices/${id}/payments`, custA.token);
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).not.toHaveProperty("note"); // internal field
    expect((await get(`/invoices/${id}/payments`, custB.token)).status).toBe(404);
    expect((await get(`/invoices/${id}`, custA.token)).body.invoice.payments[0].note).toBeNull();
  });

  it("is safe to retry: the same Idempotency-Key never pays twice", async () => {
    const id = await confirmedInvoice(100);
    const key = `idem-${TAG}-1`;
    const first = await pay(id, { method: "CASH", amount: "30.00" }, staff.token, key);
    const retry = await pay(id, { method: "CASH", amount: "30.00" }, staff.token, key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.payment.id).toBe(first.body.payment.id);
    expect(await prisma.payment.count({ where: { invoiceId: id } })).toBe(1);

    const clash = await pay(id, { method: "CASH", amount: "31.00" }, staff.token, key);
    expect(clash.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await pay(id, { method: "CASH", amount: "1" }, staff.token, "no spaces allowed")).status).toBe(400);
  });

  it("concurrent identical requests (double-click): exactly one payment, both callers get a success", async () => {
    const id = await confirmedInvoice(100);
    const key = `idem-${TAG}-twins`;
    const [a, b] = await Promise.all([pay(id, { method: "UPI", amount: "40.00" }, staff.token, key), pay(id, { method: "UPI", amount: "40.00" }, staff.token, key)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await prisma.payment.count({ where: { invoiceId: id } })).toBe(1);
    expect((await get(`/invoices/${id}`, staff.token)).body.invoice.amountPaid).toBe("40.00");
  });

  it("racing payments can't overpay: two for 70 against a balance of 118, one wins", async () => {
    const id = await confirmedInvoice(100);
    const [a, b] = await Promise.all([pay(id, { method: "CASH", amount: "70.00" }), pay(id, { method: "BANK_TRANSFER", amount: "70.00" })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe("OVERPAYMENT");
    expect((await get(`/invoices/${id}`, staff.token)).body.invoice).toMatchObject({ amountPaid: "70.00", balance: "48.00", status: "CONFIRMED" });
  });

  it("ten parallel payments that exactly settle an invoice all land, and the total is exact", async () => {
    const id = await confirmedInvoice(100); // 118.00 = 10 × 11.80
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => pay(id, { method: "UPI", amount: "11.80", reference: `P${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const inv = (await get(`/invoices/${id}`, staff.token)).body.invoice;
    expect(inv).toMatchObject({ status: "PAID", amountPaid: "118.00", balance: "0.00" });
    expect(inv.payments).toHaveLength(10);
  });

  it("cannot cancel an invoice that has payments", async () => {
    const id = await confirmedInvoice(100);
    await pay(id, { method: "CASH", amount: "5.00" });
    const r = await post(`/invoices/${id}/cancel`, { reason: "oops" }, staff.token);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("HAS_PAYMENTS");
  });

  it("flows into the reports: balances, payment state and method totals", async () => {
    const id = await confirmedInvoice(500, custB.customerId); // 590.00
    await pay(id, { method: "CHEQUE", amount: "200.00" });
    const inv = await get(`/reports/invoices?customerId=${custB.customerId}&search=${(await get(`/invoices/${id}`, staff.token)).body.invoice.number}`, staff.token);
    expect(inv.body.items[0]).toMatchObject({ paymentState: "outstanding", total: "590.00", amountPaid: "200.00", balance: "390.00" });
    const pays = await get(`/reports/payments?customerId=${custB.customerId}&method=CHEQUE`, staff.token);
    expect(pays.body.totals).toMatchObject({ payments: 1, amount: "200.00" });
  });
});

// non-JSON response helper
async function fetchHtml(path: string, token: string) {
  const r = await fetch(`${baseUrl()}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() };
}

// ═════════════════════════ scheduler settings ═════════════════════════
describe("scheduler settings", () => {
  let original: { schedulerEnabled: boolean; runHourUtc: number; autoConfirm: boolean };
  beforeAll(async () => {
    const row = await prisma.billingSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    original = { schedulerEnabled: row.schedulerEnabled, runHourUtc: row.runHourUtc, autoConfirm: row.autoConfirm };
  });
  // The row is shared by every instance of the real app: always put it back.
  afterAll(async () => {
    await prisma.billingSettings.update({ where: { id: 1 }, data: { ...original, updatedById: null } });
  });

  it("staff can read, only admins can change", async () => {
    const read = await get("/billing/settings", staff.token);
    expect(read.status).toBe(200);
    expect(read.body.settings).toMatchObject({ schedulerEnabled: expect.any(Boolean), runHourUtc: expect.any(Number), checkEveryMinutes: 5 });
    expect((await patch("/billing/settings", { autoConfirm: true }, staff.token)).status).toBe(403);
    expect((await get("/billing/settings", custA.token)).status).toBe(403);
  });

  it("validates and persists changes, recording who made them", async () => {
    for (const bad of [{}, { runHourUtc: 24 }, { runHourUtc: -1 }, { runHourUtc: 1.5 }, { schedulerEnabled: "yes" }]) {
      expect((await patch("/billing/settings", bad, admin.token)).status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await patch("/billing/settings", { schedulerEnabled: true, runHourUtc: 23, autoConfirm: true }, admin.token);
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ schedulerEnabled: true, runHourUtc: 23, autoConfirm: true, updatedBy: expect.stringContaining("admin") });
    expect(["waiting", "due", "done"]).toContain(ok.body.settings.state);
    expect((await get("/billing/settings", staff.token)).body.settings.runHourUtc).toBe(23);
  });

  it("the scheduler obeys the stored settings", async () => {
    const early = new Date("2000-01-03T05:00:00Z"); // 05:00 UTC, long ago: never collides with a real run
    await prisma.billingSettings.update({ where: { id: 1 }, data: { schedulerEnabled: false } });
    expect(await runScheduledBillingOnce(early)).toBe("disabled");
    await prisma.billingSettings.update({ where: { id: 1 }, data: { schedulerEnabled: true, runHourUtc: 23 } });
    expect(await runScheduledBillingOnce(early)).toBe("not-yet");
  });
});
