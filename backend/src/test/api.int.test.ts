import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, toDateOnly, todayUtc } from "../lib/dates.js";
import { prisma } from "../lib/prisma.js";
import { advanceBilling, claimDueSubscriptions } from "../modules/subscriptions/subscriptions.billing.js";
import { closeExpiredSubscriptions } from "../modules/subscriptions/subscriptions.service.js";
import { call, cleanup, createStaffUser, disconnect, email, get, patch, post, put, registerCustomer, startServer, stopServer, TAG } from "./harness.js";

const today = todayUtc();
const T = toDateOnly(today);
const day = (n: number) => toDateOnly(addDays(today, n));

let admin: Awaited<ReturnType<typeof createStaffUser>>;
let staff: Awaited<ReturnType<typeof createStaffUser>>;
let custA: Awaited<ReturnType<typeof registerCustomer>>;
let custB: Awaited<ReturnType<typeof registerCustomer>>;

// catalog fixtures
let termId: string, taxId: string, productId: string, variantId: string;
let planM: string, planFlex: string, planAuto: string, planYearly: string, templateId: string;

// state shared across the ordered tests below
let summaryBefore: any, revenueBefore: any;
let sub1: any, sub2: any, sub3: any, sub4: any, subB: any;

beforeAll(async () => {
  await cleanup(); // leftovers from any crashed earlier run
  await startServer();
  admin = await createStaffUser("admin", "ADMIN");
  staff = await createStaffUser("staff", "STAFF");
  custA = await registerCustomer("custA");
  custB = await registerCustomer("custB");

  const name = (s: string) => `ZZT ${TAG} ${s}`;
  termId = (await prisma.paymentTerm.create({ data: { name: name("Net7"), dueDays: 7 } })).id;
  taxId = (await prisma.tax.create({ data: { name: name("GST18"), ratePercent: 18 } })).id;
  const product = await prisma.product.create({ data: { name: name("Odoo Suite"), type: "SERVICE", salesPrice: 1000, costPrice: 400, taxId } });
  productId = product.id;
  variantId = (await prisma.productVariant.create({ data: { productId, attribute: "Brand", value: "Odoo", extraPrice: 560 } })).id;

  const plan = (n: string, extra: object) =>
    prisma.plan.create({ data: { name: name(n), price: 1000, billingPeriod: "MONTHLY", availableFrom: new Date("2020-01-01"), ...extra } }).then((p) => p.id);
  planM = await plan("Monthly", { minQuantity: 2, allowPause: true, allowRenewal: true, allowEarlyClose: false });
  planFlex = await plan("Flex", { minQuantity: 1, allowPause: false, allowRenewal: false, allowEarlyClose: true });
  planAuto = await plan("Auto", { minQuantity: 1, autoCloseOnEnd: true, allowEarlyClose: true });
  planYearly = await plan("Yearly", { billingPeriod: "YEARLY", price: 12000, minQuantity: 1 });
  templateId = (
    await prisma.quotationTemplate.create({
      data: { name: name("Template"), planId: planM, validityDays: 14, lines: { create: [{ productId, variantId, quantity: 2 }] } },
    })
  ).id;

  summaryBefore = (await get(`/reports/summary?from=${T}&to=${T}`, staff.token)).body;
  revenueBefore = (await get(`/reports/revenue?from=${T}&to=${T}&groupBy=day`, staff.token)).body;
});

afterAll(async () => {
  await cleanup();
  await stopServer();
  await disconnect();
});

const sub = async (id: string, token = staff.token) => (await get(`/subscriptions/${id}`, token)).body.subscription;
const act = (id: string, version: number, action: string, extra: object = {}, token = staff.token) =>
  post(`/subscriptions/${id}/transition`, { action, version, ...extra }, token);

// ═════════════════════════ CUSTOMERS ═════════════════════════
describe("customers", () => {
  let c1: string;

  it("staff can create a customer; internal notes are kept", async () => {
    const r = await post("/customers", { name: `${TAG} Walk-in`, email: email("walkin"), phone: "555-0100", notes: "VIP", billingAddress: { line1: "1 Main St", city: "Pune", postalCode: "411001", country: "India" } }, staff.token);
    expect(r.status).toBe(201);
    expect(r.body.customer).toMatchObject({ hasPortalAccess: false, notes: "VIP", email: email("walkin") });
    c1 = r.body.customer.id;
  });

  it("rejects a duplicate email with the existing id", async () => {
    const r = await post("/customers", { name: "Dup", email: email("walkin").toUpperCase() }, staff.token);
    expect(r.status).toBe(409);
    expect(r.body.error.details.existingCustomerId).toBe(c1);
  });

  it("validates input (bad email, unknown address keys)", async () => {
    expect((await post("/customers", { name: "X", email: "nope" }, staff.token)).status).toBe(400);
    const r = await post("/customers", { name: "X", email: email("v"), billingAddress: { line1: "a", city: "b", postalCode: "c", country: "d", hack: 1 } }, staff.token);
    expect(r.status).toBe(400);
  });

  it("customers cannot use the staff API; anonymous is 401", async () => {
    expect((await get("/customers", custA.token)).status).toBe(403);
    expect((await get("/customers")).status).toBe(401);
  });

  it("lists with search + pagination envelope and active-subscription counts", async () => {
    const r = await get(`/customers?search=${TAG}&limit=2&page=1`, staff.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, limit: 2 });
    expect(r.body.total).toBeGreaterThanOrEqual(3); // walk-in + two registered
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0]).toHaveProperty("activeSubscriptions");
    const portal = await get(`/customers?search=${TAG}&hasPortalAccess=true`, staff.token);
    expect(portal.body.total).toBe(2);
  });

  it("updates, clears optional fields, and refuses an empty patch", async () => {
    const r = await patch(`/customers/${c1}`, { name: `${TAG} Renamed`, phone: null, billingAddress: null }, staff.token);
    expect(r.status).toBe(200);
    expect(r.body.customer).toMatchObject({ name: `${TAG} Renamed`, phone: null, billingAddress: null });
    expect((await patch(`/customers/${c1}`, {}, staff.token)).status).toBe(400);
  });

  it("detail shows account standing", async () => {
    const r = await get(`/customers/${c1}`, staff.token);
    expect(r.body.customer).toMatchObject({ outstandingBalance: "0.00", overdueBalance: "0.00", subscriptionsByStatus: {} });
  });

  it("a customer reads and edits only their own profile, without internal notes", async () => {
    const p = await get("/me/profile", custA.token);
    expect(p.status).toBe(200);
    expect(p.body.profile).not.toHaveProperty("notes");
    expect(p.body.profile.id).toBe(custA.customerId);
    const u = await patch("/me/profile", { companyName: "New Co", billingAddress: { line1: "9 Road", city: "Mumbai", postalCode: "400001", country: "India" } }, custA.token);
    expect(u.body.profile.companyName).toBe("New Co");
    expect((await patch("/me/profile", { notes: "sneaky" }, custA.token)).status).toBe(400); // unknown fields are stripped → empty patch
    expect((await get("/me/profile", staff.token)).status).toBe(403);
  });

  it("only an admin can delete; a customer with no live business is soft-deleted", async () => {
    expect((await call("DELETE", `/customers/${c1}`, { token: staff.token })).status).toBe(403);
    expect((await call("DELETE", `/customers/${c1}`, { token: admin.token })).status).toBe(204);
    expect((await get(`/customers/${c1}`, staff.token)).status).toBe(404);
  });
});

// ═════════════════════════ SUBSCRIPTIONS ═════════════════════════
describe("subscriptions: creation", () => {
  it("creates from a quotation template with catalog prices, tax and totals", async () => {
    const r = await post("/subscriptions", { customerId: custA.customerId, quotationTemplateId: templateId, paymentTermId: termId, startDate: T }, staff.token);
    expect(r.status).toBe(201);
    sub1 = r.body.subscription;
    expect(sub1.number).toMatch(/^SUB-\d{4}-\d{6}$/);
    expect(sub1).toMatchObject({ status: "DRAFT", version: 1, quoteValidUntil: day(14), nextBillingDate: null });
    expect(sub1.plan.id).toBe(planM);
    expect(sub1.lines).toHaveLength(1);
    expect(sub1.lines[0]).toMatchObject({ quantity: 2, unitPrice: "1560.00", taxRatePercent: "18.00", amount: "3120.00", variantLabel: "Brand: Odoo" }); // 1000 + 560 variant
    expect(sub1.totals).toEqual({ untaxed: "3120.00", tax: "561.60", total: "3681.60" });
    expect(sub1.availableActions).toEqual(expect.arrayContaining(["send_quotation", "close"]));
    expect(sub1.history).toHaveLength(1);
  });

  it("numbers are unique and increasing", async () => {
    const r = await post("/subscriptions", { customerId: custA.customerId, planId: planFlex, paymentTermId: termId, startDate: T, lines: [{ productId, quantity: 1 }] }, staff.token);
    sub2 = r.body.subscription;
    expect(sub2.number > sub1.number).toBe(true);
    expect(sub2.lines[0].unitPrice).toBe("1000.00"); // no variant
  });

  it("only staff create; validation guards bad input", async () => {
    const base = { customerId: custA.customerId, planId: planM, paymentTermId: termId, startDate: T };
    expect((await post("/subscriptions", base, custA.token)).status).toBe(403);
    expect((await post("/subscriptions", { ...base, planId: undefined }, staff.token)).status).toBe(400); // needs plan or template
    expect((await post("/subscriptions", { ...base, expiryDate: day(-1) }, staff.token)).status).toBe(400);
    expect((await post("/subscriptions", { ...base, startDate: "2026-02-30" }, staff.token)).status).toBe(400);
    expect((await post("/subscriptions", { ...base, lines: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }] }, staff.token)).status).toBe(400);
    expect((await post("/subscriptions", { ...base, customerId: "00000000-0000-4000-8000-000000000000" }, staff.token)).status).toBe(400);
    expect((await post("/subscriptions", { ...base, lines: [{ productId, quantity: 0 }] }, staff.token)).status).toBe(400);
  });

  it("serves form options (plans, terms, products+variants, templates, taxes) to staff only", async () => {
    const r = await get("/subscriptions/options", staff.token);
    expect(r.status).toBe(200);
    expect(r.body.plans.map((p: any) => p.id)).toEqual(expect.arrayContaining([planM, planFlex]));
    expect(r.body.paymentTerms.map((t: any) => t.id)).toContain(termId);
    const prod = r.body.products.find((p: any) => p.id === productId);
    expect(prod).toMatchObject({ salesPrice: "1000.00", taxId });
    expect(prod.variants[0]).toMatchObject({ attribute: "Brand", value: "Odoo", extraPrice: "560.00" });
    expect(r.body.templates.find((t: any) => t.id === templateId).lines).toHaveLength(1);
    expect(r.body.taxes.find((t: any) => t.id === taxId).ratePercent).toBe("18.00");
    expect((await get("/subscriptions/options", custA.token)).status).toBe(403);
  });

  it("a staff price override and an explicit untaxed line are honoured", async () => {
    const r = await post("/subscriptions", { customerId: custB.customerId, planId: planFlex, paymentTermId: termId, startDate: T, lines: [{ productId, quantity: 3, unitPrice: "99.50", taxId: null }] }, staff.token);
    const l = r.body.subscription.lines[0];
    expect(l).toMatchObject({ unitPrice: "99.50", amount: "298.50", taxId: null, taxAmount: "0.00" });
    expect(r.body.subscription.totals.total).toBe("298.50");
  });
});

describe("subscriptions: lifecycle", () => {
  it("rejects skipping a step and stale versions", async () => {
    const r = await act(sub1.id, 1, "activate");
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INVALID_TRANSITION");
    const s = await act(sub1.id, 99, "send_quotation");
    expect(s.body.error.code).toBe("STALE_VERSION");
  });

  it("Draft → Quotation, and lines stay editable (with optimistic locking)", async () => {
    let r = await act(sub1.id, 1, "send_quotation");
    expect(r.body.subscription).toMatchObject({ status: "QUOTATION", version: 2 });

    const stale = await put(`/subscriptions/${sub1.id}/lines`, { version: 1, lines: [{ productId, variantId, quantity: 1 }] }, staff.token);
    expect(stale.body.error.code).toBe("STALE_VERSION");

    r = await put(`/subscriptions/${sub1.id}/lines`, { version: 2, lines: [{ productId, variantId, quantity: 1 }] }, staff.token);
    expect(r.status).toBe(200);
    expect(r.body.subscription.version).toBe(3);

    // minimum quantity of the plan (2) is enforced when the quote is accepted
    const tooFew = await act(sub1.id, 3, "confirm", {}, custA.token);
    expect(tooFew.body.error.code).toBe("MIN_QUANTITY");

    r = await put(`/subscriptions/${sub1.id}/lines`, { version: 3, lines: [{ productId, variantId, quantity: 3 }] }, staff.token);
    expect(r.body.subscription.version).toBe(4);
    expect(r.body.subscription.totals.untaxed).toBe("4680.00");
  });

  it("an expired quotation cannot be accepted", async () => {
    await prisma.subscription.update({ where: { id: sub1.id }, data: { quoteValidUntil: addDays(today, -1) } });
    const r = await act(sub1.id, 4, "confirm", {}, custA.token);
    expect(r.body.error.code).toBe("QUOTE_EXPIRED");
    await prisma.subscription.update({ where: { id: sub1.id }, data: { quoteValidUntil: addDays(today, 5) } });
  });

  it("customers only reach their own subscriptions (404, never 403)", async () => {
    expect((await get(`/subscriptions/${sub1.id}`, custB.token)).status).toBe(404);
    expect((await act(sub1.id, 4, "confirm", {}, custB.token)).status).toBe(404);
  });

  it("the customer accepts the quotation; lines are then locked; only staff activate", async () => {
    const r = await act(sub1.id, 4, "confirm", {}, custA.token);
    expect(r.body.subscription).toMatchObject({ status: "CONFIRMED", version: 5 });
    expect(r.body.subscription).not.toHaveProperty("notes"); // internal field hidden from customers
    const locked = await put(`/subscriptions/${sub1.id}/lines`, { version: 5, lines: [{ productId, quantity: 1 }] }, staff.token);
    expect(locked.body.error.code).toBe("NOT_EDITABLE");
    expect((await act(sub1.id, 5, "activate", {}, custA.token)).status).toBe(403);
  });

  it("activation schedules the first billing date and records history", async () => {
    const r = await act(sub1.id, 5, "activate");
    sub1 = r.body.subscription;
    expect(sub1).toMatchObject({ status: "ACTIVE", nextBillingDate: T });
    expect(sub1.activatedAt).toBeTruthy();
    expect(sub1.history.map((h: any) => `${h.from ?? "-"}>${h.to}`)).toEqual(["-" + ">DRAFT", "DRAFT>QUOTATION", "QUOTATION>CONFIRMED", "CONFIRMED>ACTIVE"]);
  });

  it("pause/resume follow the plan switch; the customer may do both", async () => {
    let r = await act(sub1.id, sub1.version, "pause", {}, custA.token);
    expect(r.body.subscription.status).toBe("PAUSED");
    r = await act(sub1.id, r.body.subscription.version, "resume", {}, custA.token);
    sub1 = r.body.subscription;
    expect(sub1.status).toBe("ACTIVE");
    expect(sub1.nextBillingDate).toBe(T);
  });

  it("closing needs a reason, and a live subscription can't close early unless its plan allows", async () => {
    expect((await act(sub1.id, sub1.version, "close")).status).toBe(400);
    const r = await act(sub1.id, sub1.version, "close", { reason: "moving away" });
    expect(r.body.error.code).toBe("PLAN_RULE");
    expect((await act(sub1.id, sub1.version, "renew", { expiryDate: day(60) })).body.error.code).toBe("NO_EXPIRY");
  });

  it("plan switches: no pause / no renewal on Flex, but early close is allowed", async () => {
    let v = sub2.version;
    for (const a of ["send_quotation", "confirm", "activate"]) v = (await act(sub2.id, v, a)).body.subscription.version;
    expect((await act(sub2.id, v, "pause")).body.error.code).toBe("PLAN_RULE");
    expect((await act(sub2.id, v, "renew", { expiryDate: day(90) })).body.error.code).toBe("PLAN_RULE");
    const r = await act(sub2.id, v, "close", { reason: "customer asked" });
    sub2 = r.body.subscription;
    expect(sub2).toMatchObject({ status: "CLOSED", nextBillingDate: null, closeReason: "customer asked" });
    expect(sub2.availableActions).toEqual([]);
    expect((await act(sub2.id, sub2.version, "resume")).body.error.code).toBe("INVALID_TRANSITION");
  });

  it("renewal extends the expiry only forwards and keeps the status", async () => {
    const c = await post("/subscriptions", { customerId: custA.customerId, planId: planM, paymentTermId: termId, startDate: T, expiryDate: day(30), lines: [{ productId, variantId, quantity: 2 }] }, staff.token);
    let v = c.body.subscription.version;
    for (const a of ["send_quotation", "confirm", "activate"]) v = (await act(c.body.subscription.id, v, a)).body.subscription.version;
    sub3 = c.body.subscription;
    expect((await act(sub3.id, v, "renew", { expiryDate: day(10) })).status).toBe(400); // earlier than current expiry
    expect((await act(sub3.id, v, "renew")).status).toBe(400); // missing new date
    const r = await act(sub3.id, v, "renew", { expiryDate: day(120) });
    sub3 = r.body.subscription;
    expect(sub3).toMatchObject({ status: "ACTIVE", expiryDate: day(120) });
  });

  it("header edits: allowed in draft, rejected once confirmed", async () => {
    const c = await post("/subscriptions", { customerId: custA.customerId, planId: planFlex, paymentTermId: termId, startDate: T, lines: [{ productId, quantity: 1 }] }, staff.token);
    const id = c.body.subscription.id;
    const r = await patch(`/subscriptions/${id}`, { version: 1, notes: "check", expiryDate: day(200) }, staff.token);
    expect(r.body.subscription).toMatchObject({ notes: "check", expiryDate: day(200), version: 2 });
    expect((await patch(`/subscriptions/${id}`, { version: 2, expiryDate: day(-5) }, staff.token)).status).toBe(400);
    expect((await patch(`/subscriptions/${id}`, { version: 1, notes: "stale" }, staff.token)).body.error.code).toBe("STALE_VERSION");
    let v = 2;
    for (const a of ["send_quotation", "confirm"]) v = (await act(id, v, a)).body.subscription.version;
    expect((await patch(`/subscriptions/${id}`, { version: v, notes: "late" }, staff.token)).body.error.code).toBe("NOT_EDITABLE");
  });

  it("two concurrent transitions: exactly one wins", async () => {
    const c = await post("/subscriptions", { customerId: custB.customerId, planId: planYearly, paymentTermId: termId, startDate: T, lines: [{ productId, variantId, quantity: 1 }] }, staff.token);
    subB = c.body.subscription;
    const [a, b] = await Promise.all([act(subB.id, 1, "send_quotation"), act(subB.id, 1, "send_quotation")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.error?.code, b.body.error?.code].filter(Boolean)).toEqual(["STALE_VERSION"]);
    let v = 2;
    for (const x of ["confirm", "activate"]) v = (await act(subB.id, v, x)).body.subscription.version;
    subB = await sub(subB.id);
    expect(subB.status).toBe("ACTIVE");
  });
});

describe("subscriptions: listing & scoping", () => {
  it("a customer sees only their own subscriptions", async () => {
    const a = await get("/subscriptions?limit=100", custA.token);
    expect(a.body.items.length).toBeGreaterThanOrEqual(3);
    expect(a.body.items.every((s: any) => s.customer.id === custA.customerId)).toBe(true);
    // a customer cannot widen the scope with a customerId filter
    const spoof = await get(`/subscriptions?customerId=${custB.customerId}`, custA.token);
    expect(spoof.body.items.every((s: any) => s.customer.id === custA.customerId)).toBe(true);
  });

  it("staff filter by status list, customer and search; items carry period totals", async () => {
    const r = await get(`/subscriptions?customerId=${custA.customerId}&status=ACTIVE,PAUSED&sort=number`, staff.token);
    expect(r.body.items.map((s: any) => s.status).every((s: string) => s === "ACTIVE" || s === "PAUSED")).toBe(true);
    const first = r.body.items.find((s: any) => s.id === sub1.id);
    expect(first.totals).toEqual({ untaxed: "4680.00", tax: "842.40", total: "5522.40" });
    const found = await get(`/subscriptions?search=${sub1.number}`, staff.token);
    expect(found.body.items.map((s: any) => s.id)).toContain(sub1.id);
    expect((await get("/subscriptions?status=NOPE", staff.token)).status).toBe(400);
  });
});

describe("subscriptions: auto-close and the billing contract", () => {
  it("closes only plan-flagged, expired, live subscriptions", async () => {
    const c = await post("/subscriptions", { customerId: custA.customerId, planId: planAuto, paymentTermId: termId, startDate: day(-10), expiryDate: day(-1), lines: [{ productId, quantity: 1 }] }, staff.token);
    sub4 = c.body.subscription;
    let v = 1;
    for (const a of ["send_quotation", "confirm", "activate"]) v = (await act(sub4.id, v, a)).body.subscription.version;

    const n = await closeExpiredSubscriptions(today, { subscriptionIds: [sub4.id, sub1.id, sub3.id] });
    expect(n).toBe(1); // sub1/sub3 have no expiry in the past → untouched
    sub4 = await sub(sub4.id);
    expect(sub4).toMatchObject({ status: "CLOSED", closeReason: "Plan ended (auto-closed)", nextBillingDate: null });
    expect((await sub(sub1.id)).status).toBe("ACTIVE");
    expect((await post("/subscriptions/maintenance/close-expired", {}, staff.token)).status).toBe(403);
  });

  it("claims due subscriptions without double-claiming across workers, then advances the schedule drift-free", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    let claimedFirst!: () => void;
    const firstClaimed = new Promise<void>((r) => (claimedFirst = r));
    let firstIds: string[] = [];

    const worker1 = prisma.$transaction(
      async (tx) => {
        const due = await claimDueSubscriptions(tx, today, 1000);
        firstIds = due.map((d) => d.id);
        claimedFirst();
        await hold; // keep the row locks while worker 2 tries
        const mine = due.find((d) => d.id === sub1.id)!;
        await advanceBilling(tx, mine);
      },
      { timeout: 30_000, maxWait: 30_000 },
    );

    await firstClaimed;
    expect(firstIds).toContain(sub1.id);
    const secondIds = await prisma.$transaction(async (tx) => (await claimDueSubscriptions(tx, today, 1000)).map((d) => d.id));
    expect(secondIds).not.toContain(sub1.id); // locked by worker 1 → skipped, not blocked
    release();
    await worker1;

    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub1.id } });
    expect(toDateOnly(after.nextBillingDate!)).toBe(toDateOnly(nextMonthSameDay(today)));
  });

  it("customers with live business cannot be deleted", async () => {
    const r = await call("DELETE", `/customers/${custA.customerId}`, { token: admin.token });
    expect(r.status).toBe(409);
    expect(r.body.error.details.openSubscriptions).toBeGreaterThan(0);
  });
});

function nextMonthSameDay(d: Date) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}

// ═════════════════════════ REPORTS ═════════════════════════
describe("reports", () => {
  let invOverdue: string, invOpen: string, invPaid: string;

  beforeAll(async () => {
    const mk = (n: number, status: "CONFIRMED" | "PAID" | "DRAFT", periodStart: number, issue: number, due: number, total: number, paid: number) =>
      prisma.invoice.create({
        data: {
          number: status === "DRAFT" ? null : `ZZT-${TAG}-${n}`,
          subscriptionId: sub1.id,
          customerId: custA.customerId,
          status,
          periodStart: addDays(today, periodStart),
          periodEnd: addDays(today, periodStart + 29),
          issueDate: addDays(today, issue),
          dueDate: addDays(today, due),
          subtotal: total,
          taxTotal: 0,
          total,
          amountPaid: paid,
          billToName: `${TAG} A`,
          billToEmail: custA.email,
          confirmedAt: status === "DRAFT" ? null : new Date(),
          paidAt: status === "PAID" ? new Date() : null,
        },
      });
    invOverdue = (await mk(1, "CONFIRMED", -60, -45, -35, 100, 25)).id; // 35 days overdue, 75 left
    invOpen = (await mk(2, "CONFIRMED", -30, 0, 10, 200, 50)).id; // not yet due, 150 left
    invPaid = (await mk(3, "PAID", -90, 0, 14, 300, 300)).id;
    await mk(4, "DRAFT", -120, 0, 7, 999, 0); // drafts never count anywhere
    const pay = (invoiceId: string, method: any, amount: number, daysAgo: number) =>
      prisma.payment.create({ data: { invoiceId, method, amount, paidAt: new Date(Date.now() - daysAgo * 86_400_000) } });
    await pay(invOverdue, "UPI", 25, 40);
    await pay(invOpen, "CASH", 50, 0);
    await pay(invPaid, "BANK_TRANSFER", 300, 0);
  });

  it("is finance-only", async () => {
    expect((await get("/reports/summary", custA.token)).status).toBe(403);
    expect((await get("/reports/summary")).status).toBe(401);
  });

  it("validates ranges", async () => {
    expect((await get(`/reports/summary?from=${day(1)}&to=${T}`, staff.token)).status).toBe(400);
    expect((await get("/reports/summary?from=2000-01-01&to=2026-01-01", staff.token)).status).toBe(400);
    expect((await get(`/reports/revenue?from=${day(-800)}&to=${T}&groupBy=day`, staff.token)).status).toBe(400);
  });

  it("summary deltas match exactly what this test created", async () => {
    const after = (await get(`/reports/summary?from=${T}&to=${T}`, staff.token)).body;
    const dec = (a: string, b: string) => (Number(a) - Number(b)).toFixed(2);
    expect(after.subscriptions.active - summaryBefore.subscriptions.active).toBe(3); // sub1, sub3, subB
    expect(dec(after.recurringRevenue.mrr, summaryBefore.recurringRevenue.mrr)).toBe("7930.00"); // 4680 + 3120 + 1560/12 (yearly)
    expect(dec(after.recurringRevenue.arr, summaryBefore.recurringRevenue.arr)).toBe("95160.00");
    expect(dec(after.revenue.collected, summaryBefore.revenue.collected)).toBe("350.00"); // 50 + 300 today (the old 25 is outside the range)
    expect(after.revenue.payments - summaryBefore.revenue.payments).toBe(2);
    expect(dec(after.invoiced.total, summaryBefore.invoiced.total)).toBe("500.00"); // open 200 + paid 300 issued today; draft excluded
    expect(after.invoiced.paidInFull - summaryBefore.invoiced.paidInFull).toBe(1);
    expect(dec(after.outstanding.amount, summaryBefore.outstanding.amount)).toBe("225.00"); // 75 + 150
    expect(after.outstanding.invoices - summaryBefore.outstanding.invoices).toBe(2);
    expect(dec(after.outstanding.overdueAmount, summaryBefore.outstanding.overdueAmount)).toBe("75.00");
    expect(after.outstanding.overdueInvoices - summaryBefore.outstanding.overdueInvoices).toBe(1);
  });

  it("revenue time-series fills every bucket and tracks collected vs invoiced", async () => {
    const d = (await get(`/reports/revenue?from=${T}&to=${T}&groupBy=day`, staff.token)).body;
    expect(d.points).toHaveLength(1);
    expect(Number(d.points[0].collected) - Number(revenueBefore.points[0].collected)).toBe(350);
    expect(Number(d.points[0].invoiced) - Number(revenueBefore.points[0].invoiced)).toBe(500);

    const gaps = (await get(`/reports/revenue?from=${day(-4)}&to=${T}&groupBy=day`, staff.token)).body;
    expect(gaps.points.map((p: any) => p.bucket)).toEqual([-4, -3, -2, -1, 0].map(day)); // contiguous, zero-filled
    const monthly = (await get(`/reports/revenue?from=${day(-70)}&to=${T}&groupBy=month`, staff.token)).body;
    expect(monthly.points.length).toBeGreaterThanOrEqual(3);
    expect(monthly.points.every((p: any) => /^\d{4}-\d{2}-01$/.test(p.bucket))).toBe(true);
    const weekly = (await get(`/reports/revenue?from=${day(-20)}&to=${T}&groupBy=week`, staff.token)).body;
    expect(weekly.points.length).toBeGreaterThanOrEqual(3);
  });

  it("overdue: aging buckets, days overdue and balance", async () => {
    const r = (await get(`/reports/overdue?customerId=${custA.customerId}`, staff.token)).body;
    expect(r.summary.invoices).toBe(1);
    expect(r.summary.amount).toBe("75.00");
    expect(r.summary.aging).toEqual([
      { bucket: "1-30", invoices: 0, amount: "0.00" },
      { bucket: "31-60", invoices: 1, amount: "75.00" },
      { bucket: "61-90", invoices: 0, amount: "0.00" },
      { bucket: "90+", invoices: 0, amount: "0.00" },
    ]);
    expect(r.items[0]).toMatchObject({ id: invOverdue, daysOverdue: 35, balance: "75.00", total: "100.00", amountPaid: "25.00" });
    expect((await get(`/reports/overdue?customerId=${custA.customerId}&minDaysOverdue=40`, staff.token)).body.total).toBe(0);
    expect((await get(`/reports/overdue?customerId=${custA.customerId}&asOf=${day(60)}`, staff.token)).body.summary.invoices).toBe(2); // open invoice is overdue by then
  });

  it("invoices by payment state, with totals over the whole filtered set", async () => {
    const q = (state: string) => get(`/reports/invoices?customerId=${custA.customerId}&state=${state}`, staff.token).then((r) => r.body);
    const paid = await q("paid");
    expect(paid.total).toBe(1);
    expect(paid.items[0]).toMatchObject({ id: invPaid, paymentState: "paid", balance: "0.00" });
    const out = await q("outstanding");
    expect(out.total).toBe(2);
    expect(out.totals).toEqual({ invoices: 2, total: "300.00", paid: "75.00", balance: "225.00" });
    expect(out.items.map((i: any) => i.paymentState).sort()).toEqual(["outstanding", "overdue"]);
    expect((await q("overdue")).items.map((i: any) => i.id)).toEqual([invOverdue]);
    expect((await q("all")).total).toBe(3); // the draft is excluded
    expect((await get(`/reports/invoices?customerId=${custA.customerId}&search=ZZT-${TAG}-2`, staff.token)).body.items.map((i: any) => i.id)).toEqual([invOpen]);
  });

  it("payments with method breakdown, filters and date range", async () => {
    const all = (await get(`/reports/payments?customerId=${custA.customerId}`, staff.token)).body;
    expect(all.totals).toEqual({ payments: 3, amount: "375.00" });
    expect(Object.fromEntries(all.byMethod.map((m: any) => [m.method, m.amount]))).toEqual({ UPI: "25.00", CASH: "50.00", BANK_TRANSFER: "300.00" });
    expect((await get(`/reports/payments?customerId=${custA.customerId}&method=UPI`, staff.token)).body.total).toBe(1);
    const today2 = (await get(`/reports/payments?customerId=${custA.customerId}&from=${T}&to=${T}`, staff.token)).body;
    expect(today2.totals.amount).toBe("350.00");
    expect(today2.items[0].customer.id).toBe(custA.customerId);
  });

  it("subscriptions report: MRR by plan, status mix and sorting", async () => {
    const r = (await get(`/reports/subscriptions?customerId=${custA.customerId}`, staff.token)).body;
    expect(r.summary.byStatus).toMatchObject({ ACTIVE: 2, CLOSED: 2 });
    expect(r.summary.mrr).toBe("7800.00");
    expect(r.summary.mrrByPlan).toEqual([expect.objectContaining({ planId: planM, subscriptions: 2, mrr: "7800.00" })]);
    expect(r.items[0]).toMatchObject({ id: sub1.id, mrr: "4680.00", amountPerPeriod: "4680.00" }); // highest MRR first
    expect(r.items.filter((i: any) => i.status === "CLOSED").every((i: any) => i.mrr === "0.00")).toBe(true);
    const closed = (await get(`/reports/subscriptions?customerId=${custA.customerId}&status=CLOSED`, staff.token)).body;
    expect(closed.total).toBe(2);
    const yearly = (await get(`/reports/subscriptions?customerId=${custB.customerId}&status=ACTIVE`, staff.token)).body;
    expect(yearly.items.find((i: any) => i.id === subB.id).mrr).toBe("130.00"); // 1560 / 12
  });
});
