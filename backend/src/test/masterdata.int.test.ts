import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, toDateOnly, todayUtc } from "../lib/dates.js";
import { prisma } from "../lib/prisma.js";
import { executeRun } from "../modules/billing/engine.js";
import { call, cleanup, createStaffUser, disconnect, get, patch, post, registerCustomer, startServer, stopServer, TAG } from "./harness.js";

const today = todayUtc();
const T = toDateOnly(today);
const name = (s: string) => `ZZT ${TAG} ${s}`;
const del = (path: string, token: string) => call("DELETE", path, { token });
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

let admin: Awaited<ReturnType<typeof createStaffUser>>;
let staff: Awaited<ReturnType<typeof createStaffUser>>;
let cust: Awaited<ReturnType<typeof registerCustomer>>;
let defaultTermBefore: string | undefined;

beforeAll(async () => {
  await cleanup();
  await startServer();
  admin = await createStaffUser("admin", "ADMIN");
  staff = await createStaffUser("staff", "STAFF");
  cust = await registerCustomer("cust");
  defaultTermBefore = (await prisma.paymentTerm.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id;
});

afterAll(async () => {
  // the payment-terms test moves the "default" flag; put it back exactly as we found it
  await prisma.paymentTerm.updateMany({ data: { isDefault: false } });
  if (defaultTermBefore) await prisma.paymentTerm.update({ where: { id: defaultTermBefore }, data: { isDefault: true } }).catch(() => undefined);
  await cleanup();
  await stopServer();
  await disconnect();
});

// ═════════════════════════ wiring & access ═════════════════════════
describe("access control", () => {
  const paths = ["/taxes", "/products", "/payment-terms", "/plans", "/quotation-templates", "/discounts"];

  it("every master-data route is mounted and requires a login", async () => {
    for (const p of paths) expect((await get(p)).status, p).toBe(401);
  });

  it("customers are refused everywhere", async () => {
    for (const p of paths) expect((await get(p, cust.token)).status, p).toBe(403);
  });

  it("staff can read all of it, but only an admin can write", async () => {
    for (const p of paths) expect((await get(p, staff.token)).status, p).toBe(200);
    expect((await post("/taxes", { name: name("nope"), ratePercent: "5" }, staff.token)).status).toBe(403);
    expect((await post("/products", { name: name("nope"), type: "SERVICE", salesPrice: "1", costPrice: "1" }, staff.token)).status).toBe(403);
    expect((await post("/plans", { name: name("nope"), price: "1", billingPeriod: "MONTHLY", availableFrom: T }, staff.token)).status).toBe(403);
    expect((await post("/discounts", { name: name("nope"), type: "FIXED", value: "5", scope: "SUBSCRIPTION", startDate: T }, staff.token)).status).toBe(403);
    expect((await post("/payment-terms", { name: name("nope"), dueDays: 5 }, staff.token)).status).toBe(403);
  });

  it("did not put a login wall in front of the public routes", async () => {
    const r = await post("/auth/login", { email: "nobody@example.test", password: "x" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHORIZED"); // from the login handler itself, not a blanket middleware
    expect((await get("/healthz").catch(() => ({ status: 0 }))).status).not.toBe(500);
  });
});

// ═════════════════════════ taxes ═════════════════════════
describe("taxes", () => {
  let gst: string;

  it("creates with a normalised rate and rejects bad input", async () => {
    const r = await post("/taxes", { name: name("GST"), ratePercent: "18" }, admin.token);
    expect(r.status).toBe(201);
    expect(r.body.tax).toMatchObject({ name: name("GST"), ratePercent: "18.00", isActive: true });
    gst = r.body.tax.id;
    for (const bad of [{ ratePercent: "101" }, { ratePercent: "-1" }, { ratePercent: "abc" }, { ratePercent: "12.345" }, { ratePercent: "" }, { name: "" }, { name: "x".repeat(101) }]) {
      expect((await post("/taxes", { name: name("bad"), ratePercent: "5", ...bad }, admin.token)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("names are unique among live taxes, case-insensitively", async () => {
    const r = await post("/taxes", { name: name("gst"), ratePercent: "5" }, admin.token);
    expect(r.status).toBe(409);
  });

  it("lists, searches, paginates and updates", async () => {
    const list = await get(`/taxes?search=${TAG}&limit=5`, staff.token);
    expect(list.body).toMatchObject({ page: 1, limit: 5 });
    expect(list.body.items.map((t: any) => t.id)).toContain(gst);
    expect((await patch(`/taxes/${gst}`, { ratePercent: "12.5" }, admin.token)).body.tax.ratePercent).toBe("12.50");
    expect((await patch(`/taxes/${gst}`, {}, admin.token)).status).toBe(400); // an empty patch is a mistake, not a no-op
    expect((await get(`/taxes/${UNKNOWN}`, admin.token)).status).toBe(404);
    expect((await get("/taxes?limit=1000", admin.token)).status).toBe(400);
  });

  it("can't be deleted while a product uses it, and an inactive tax can't be newly assigned", async () => {
    const p = await post("/products", { name: name("taxed"), type: "SERVICE", salesPrice: "100", costPrice: "10", taxId: gst }, admin.token);
    expect(p.status).toBe(201);
    const blocked = await del(`/taxes/${gst}`, admin.token);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: "IN_USE", details: { products: 1 } });

    const other = (await post("/taxes", { name: name("VAT"), ratePercent: "5", isActive: false }, admin.token)).body.tax.id;
    const r = await post("/products", { name: name("badtax"), type: "SERVICE", salesPrice: "1", costPrice: "1", taxId: other }, admin.token);
    expect(r.body.error.code).toBe("TAX_UNAVAILABLE");
    expect((await del(`/taxes/${other}`, admin.token)).status).toBe(204);
    // a deleted tax's name is free again
    expect((await post("/taxes", { name: name("VAT"), ratePercent: "5" }, admin.token)).status).toBe(201);
  });
});

// ═════════════════════════ products & variants ═════════════════════════
describe("products and variants", () => {
  let product: string;
  let odoo: string;

  it("creates with 2-decimal money strings and validates amounts", async () => {
    const r = await post("/products", { name: name("CRM"), type: "SERVICE", salesPrice: 1000, costPrice: "400.5", notes: "main product" }, admin.token);
    expect(r.status).toBe(201);
    expect(r.body.product).toMatchObject({ salesPrice: "1000.00", costPrice: "400.50", isActive: true, variants: [], tax: null });
    product = r.body.product.id;
    for (const bad of [{ salesPrice: "-1" }, { salesPrice: "12345678901" }, { salesPrice: "1.234" }, { costPrice: "x" }, { type: "SOFTWARE" }]) {
      expect((await post("/products", { name: name("bad"), type: "SERVICE", salesPrice: "1", costPrice: "1", ...bad }, admin.token)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post("/products", { name: name("crm"), type: "SERVICE", salesPrice: "1", costPrice: "1" }, admin.token)).status).toBe(409); // same name, different case
  });

  it("adds variants (the 560 Odoo example) and rejects duplicates and bad prices", async () => {
    const r = await post(`/products/${product}/variants`, { attribute: "Brand", value: "Odoo", extraPrice: "560" }, admin.token);
    expect(r.status).toBe(201);
    expect(r.body.variant).toMatchObject({ attribute: "Brand", value: "Odoo", extraPrice: "560.00", isActive: true });
    odoo = r.body.variant.id;
    expect((await post(`/products/${product}/variants`, { attribute: "Brand", value: "Odoo" }, admin.token)).status).toBe(409);
    expect((await post(`/products/${product}/variants`, { attribute: "Brand", value: "Zoho", extraPrice: "-5" }, admin.token)).status).toBe(400);
    expect((await post(`/products/${UNKNOWN}/variants`, { attribute: "a", value: "b" }, admin.token)).status).toBe(404);
    const list = await get(`/products/${product}/variants`, staff.token);
    expect(list.body.items).toHaveLength(1);
    const detail = await get(`/products/${product}`, staff.token);
    expect(detail.body.product.variants[0].extraPrice).toBe("560.00");
  });

  it("updates, filters and finds products", async () => {
    expect((await patch(`/products/${product}`, { salesPrice: "1100" }, admin.token)).body.product.salesPrice).toBe("1100.00");
    expect((await patch(`/products/${product}`, {}, admin.token)).status).toBe(400);
    const list = await get(`/products?search=${TAG}&type=SERVICE&isActive=true`, staff.token);
    expect(list.body.items.map((p: any) => p.id)).toContain(product);
    expect((await get("/products?isActive=maybe", staff.token)).status).toBe(400);
  });

  it("variants and products that are in use can't be removed (a precise 409, never a 500)", async () => {
    const plan = (await post("/plans", { name: name("P for tpl"), price: "10", billingPeriod: "MONTHLY", availableFrom: T }, admin.token)).body.plan.id;
    const tpl = await post("/quotation-templates", { name: name("tpl uses"), planId: plan, lines: [{ productId: product, variantId: odoo, quantity: 2 }] }, admin.token);
    expect(tpl.status).toBe(201);

    const v = await del(`/products/${product}/variants/${odoo}`, admin.token);
    expect(v.status).toBe(409);
    expect(v.body.error).toMatchObject({ code: "IN_USE", details: { "quotation template lines": 1 } });
    const p = await del(`/products/${product}`, admin.token);
    expect(p.status).toBe(409);
    expect(p.body.error.details["quotation template lines"]).toBe(1);

    await del(`/quotation-templates/${tpl.body.template.id}`, admin.token);
    expect((await del(`/products/${product}/variants/${odoo}`, admin.token)).status).toBe(204);
    expect((await del(`/products/${product}`, admin.token)).status).toBe(204);
    expect((await get(`/products/${product}`, admin.token)).status).toBe(404);
  });
});

// ═════════════════════════ payment terms ═════════════════════════
describe("payment terms", () => {
  it("validates days strictly (no silent null → 0 coercion)", async () => {
    for (const dueDays of [null, -1, 366, 1.5, "15", undefined]) {
      expect((await post("/payment-terms", { name: name("t"), dueDays }, admin.token)).status, String(dueDays)).toBe(400);
    }
  });

  it("keeps exactly one default and refuses duplicate names", async () => {
    const a = await post("/payment-terms", { name: name("Net 7"), dueDays: 7, isDefault: true }, admin.token);
    expect(a.status).toBe(201);
    const b = await post("/payment-terms", { name: name("Net 9"), dueDays: 9, isDefault: true }, admin.token);
    expect(b.body.paymentTerm.isDefault).toBe(true);
    expect((await prisma.paymentTerm.count({ where: { isDefault: true } }))).toBe(1);
    expect((await get(`/payment-terms/${a.body.paymentTerm.id}`, staff.token)).body.paymentTerm.isDefault).toBe(false);
    expect((await post("/payment-terms", { name: name("Net 7"), dueDays: 7 }, admin.token)).status).toBe(409);
    expect((await patch(`/payment-terms/${a.body.paymentTerm.id}`, { isDefault: true }, admin.token)).body.paymentTerm.isDefault).toBe(true);
    expect(await prisma.paymentTerm.count({ where: { isDefault: true } })).toBe(1);
  });

  it("can't delete a term subscriptions use; an unused one goes", async () => {
    const used = (await post("/payment-terms", { name: name("Used term"), dueDays: 3 }, admin.token)).body.paymentTerm.id;
    const free = (await post("/payment-terms", { name: name("Free term"), dueDays: 4 }, admin.token)).body.paymentTerm.id;
    const plan = await prisma.plan.create({ data: { name: name("pl for term"), price: 1, billingPeriod: "MONTHLY", availableFrom: today } });
    await prisma.subscription.create({ data: { number: `ZZT-${TAG}-term`, customerId: cust.customerId, planId: plan.id, paymentTermId: used, status: "DRAFT", startDate: today } });
    const r = await del(`/payment-terms/${used}`, admin.token);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "IN_USE", details: { subscriptions: 1 } });
    expect((await del(`/payment-terms/${free}`, admin.token)).status).toBe(204);
  });
});

// ═════════════════════════ plans ═════════════════════════
describe("plans", () => {
  let plan: string;
  let termId: string;

  beforeAll(async () => {
    termId = (await prisma.paymentTerm.create({ data: { name: name("plan term"), dueDays: 10 } })).id;
  });

  it("creates with defaults and normalised values", async () => {
    const r = await post("/plans", { name: name("Monthly"), price: "1000", billingPeriod: "MONTHLY", availableFrom: "2026-01-01", allowPause: true }, admin.token);
    expect(r.status).toBe(201);
    expect(r.body.plan).toMatchObject({ price: "1000.00", billingInterval: 1, minQuantity: 1, availableFrom: "2026-01-01", availableUntil: null, allowPause: true, allowRenewal: true, allowEarlyClose: false, autoCloseOnEnd: false, isActive: true, liveSubscriptions: 0 });
    plan = r.body.plan.id;
  });

  it("rejects impossible dates, reversed windows and out-of-range numbers", async () => {
    const base = { name: name("bad"), price: "1", billingPeriod: "MONTHLY", availableFrom: "2026-01-01" };
    for (const bad of [{ availableFrom: "2026-02-30" }, { availableUntil: "2025-12-31" }, { billingInterval: 0 }, { billingInterval: 366 }, { minQuantity: null }, { minQuantity: 0 }, { price: "12345678901" }, { billingPeriod: "HOURLY" }]) {
      expect((await post("/plans", { ...base, ...bad }, admin.token)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post("/plans", { ...base, name: name("monthly") }, admin.token)).status).toBe(409); // same name as above, different case
  });

  it("flags and prices can change any time; an empty patch is refused", async () => {
    const r = await patch(`/plans/${plan}`, { price: "1200", allowEarlyClose: true, availableUntil: "2030-12-31" }, admin.token);
    expect(r.body.plan).toMatchObject({ price: "1200.00", allowEarlyClose: true, availableUntil: "2030-12-31" });
    expect((await patch(`/plans/${plan}`, {}, admin.token)).status).toBe(400);
    expect((await patch(`/plans/${plan}`, { availableUntil: "2020-01-01" }, admin.token)).status).toBe(400); // before availableFrom
  });

  it("the billing cycle is locked while subscriptions bill on it", async () => {
    const sub = await prisma.subscription.create({
      data: { number: `ZZT-${TAG}-lock`, customerId: cust.customerId, planId: plan, paymentTermId: termId, status: "ACTIVE", startDate: today, nextBillingDate: addDays(today, 30), activatedAt: new Date() },
    });
    const blocked = await patch(`/plans/${plan}`, { billingPeriod: "YEARLY" }, admin.token);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: "PLAN_IN_USE", details: { liveSubscriptions: 1 } });
    expect((await patch(`/plans/${plan}`, { billingInterval: 3 }, admin.token)).status).toBe(409);
    expect((await patch(`/plans/${plan}`, { billingPeriod: "MONTHLY", price: "1300" }, admin.token)).status).toBe(200); // same cycle: fine
    expect((await get(`/plans/${plan}`, staff.token)).body.plan.liveSubscriptions).toBe(1);

    const del409 = await del(`/plans/${plan}`, admin.token);
    expect(del409.status).toBe(409);
    expect(del409.body.error.details.subscriptions).toBe(1);

    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CLOSED", nextBillingDate: null } });
    expect((await patch(`/plans/${plan}`, { billingPeriod: "YEARLY" }, admin.token)).status).toBe(200); // nothing live any more
    await patch(`/plans/${plan}`, { billingPeriod: "MONTHLY" }, admin.token);
  });

  it("an inactive plan stops being offered for new subscriptions", async () => {
    await patch(`/plans/${plan}`, { isActive: false }, admin.token);
    const opts = await get("/subscriptions/options", staff.token);
    expect(opts.body.plans.map((p: any) => p.id)).not.toContain(plan);
    await patch(`/plans/${plan}`, { isActive: true }, admin.token);
    expect((await get("/subscriptions/options", staff.token)).body.plans.map((p: any) => p.id)).toContain(plan);
  });
});

// ═════════════════════════ quotation templates ═════════════════════════
describe("quotation templates", () => {
  let plan: string;
  let p1: string, p2: string, v1: string;
  let tpl: string;

  beforeAll(async () => {
    plan = (await prisma.plan.create({ data: { name: name("tpl plan"), price: 100, billingPeriod: "MONTHLY", availableFrom: new Date("2020-01-01") } })).id;
    p1 = (await prisma.product.create({ data: { name: name("tp1"), type: "SERVICE", salesPrice: 1000, costPrice: 1 } })).id;
    p2 = (await prisma.product.create({ data: { name: name("tp2"), type: "SERVICE", salesPrice: 250, costPrice: 1 } })).id;
    v1 = (await prisma.productVariant.create({ data: { productId: p1, attribute: "Brand", value: "Odoo", extraPrice: 560 } })).id;
  });

  it("creates with lines in the order given, priced from the catalog", async () => {
    const r = await post("/quotation-templates", { name: name("starter"), planId: plan, validityDays: 14, lines: [{ productId: p2, quantity: 1 }, { productId: p1, variantId: v1, quantity: 3 }, { productId: p2, quantity: 2 }] }, admin.token);
    expect(r.status).toBe(201);
    const t = r.body.template;
    expect(t.lines.map((l: any) => [l.sortOrder, l.productId, l.quantity])).toEqual([[0, p2, 1], [1, p1, 3], [2, p2, 2]]);
    expect(t.lines[1]).toMatchObject({ variantLabel: "Brand: Odoo", unitPrice: "1560.00", amount: "4680.00" });
    expect(t).toMatchObject({ validityDays: 14, estimatedUntaxed: "5430.00", usable: true, problems: [] });
    tpl = t.id;
  });

  it("refuses unusable lines, with the failing line number", async () => {
    const make = (lines: unknown[]) => post("/quotation-templates", { name: name("bad tpl"), planId: plan, lines }, admin.token);
    expect((await make([{ productId: UNKNOWN }])).status).toBe(400);
    const other = (await prisma.product.create({ data: { name: name("other"), type: "SERVICE", salesPrice: 1, costPrice: 1 } })).id;
    const wrongVariant = await make([{ productId: p2, quantity: 1 }, { productId: other, variantId: v1 }]); // v1 belongs to p1
    expect(wrongVariant.status).toBe(400);
    expect(wrongVariant.body.error.message).toContain("lines[1]");
    expect((await make(Array.from({ length: 101 }, () => ({ productId: p2 })))).status).toBe(400);
    expect((await make([{ productId: p2, quantity: 0 }])).status).toBe(400);
    expect((await post("/quotation-templates", { name: name("noplan"), planId: UNKNOWN }, admin.token)).status).toBe(404);
    await prisma.product.update({ where: { id: other }, data: { isActive: false } });
    expect((await make([{ productId: other }])).status).toBe(400); // inactive products can't be templated
  });

  it("updating lines replaces them; other edits leave them alone", async () => {
    const renamed = await patch(`/quotation-templates/${tpl}`, { name: name("starter v2") }, admin.token);
    expect(renamed.body.template.lines).toHaveLength(3);
    const replaced = await patch(`/quotation-templates/${tpl}`, { lines: [{ productId: p1, quantity: 5 }] }, admin.token);
    expect(replaced.body.template.lines).toHaveLength(1);
    expect(replaced.body.template.lines[0]).toMatchObject({ quantity: 5, unitPrice: "1000.00" });
    expect((await patch(`/quotation-templates/${tpl}`, {}, admin.token)).status).toBe(400);
  });

  it("reports why a template stopped working, instead of failing later at quote time", async () => {
    await prisma.product.update({ where: { id: p1 }, data: { isActive: false } });
    await prisma.plan.update({ where: { id: plan }, data: { isActive: false } });
    const t = (await get(`/quotation-templates/${tpl}`, staff.token)).body.template;
    expect(t.usable).toBe(false);
    expect(t.problems.join(" ")).toMatch(/no longer active/);
    expect(t.problems.join(" ")).toMatch(/no longer sold/);
    await prisma.product.update({ where: { id: p1 }, data: { isActive: true } });
    await prisma.plan.update({ where: { id: plan }, data: { isActive: true } });
    expect((await get(`/quotation-templates/${tpl}`, staff.token)).body.template.usable).toBe(true);
  });

  it("a plan used by a template can't be deleted; a subscription can still start from the template", async () => {
    const blocked = await del(`/plans/${plan}`, admin.token);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details.templates).toBe(1);

    const term = (await prisma.paymentTerm.create({ data: { name: name("tpl term"), dueDays: 5 } })).id;
    const r = await post("/subscriptions", { customerId: cust.customerId, quotationTemplateId: tpl, paymentTermId: term, startDate: T }, staff.token);
    expect(r.status).toBe(201);
    expect(r.body.subscription.lines[0]).toMatchObject({ quantity: 5, unitPrice: "1000.00" });
    expect(r.body.subscription.quoteValidUntil).toBe(toDateOnly(addDays(today, 14)));
  });

  it("deletes softly and lists with filters", async () => {
    const list = await get(`/quotation-templates?search=${TAG}&planId=${plan}`, staff.token);
    expect(list.body.items.map((t: any) => t.id)).toContain(tpl);
    expect((await del(`/quotation-templates/${tpl}`, admin.token)).status).toBe(204);
    expect((await get(`/quotation-templates/${tpl}`, staff.token)).status).toBe(404);
    expect((await del(`/quotation-templates/${tpl}`, admin.token)).status).toBe(404);
  });
});

// ═════════════════════════ discounts ═════════════════════════
describe("discounts", () => {
  let prod: string;
  let termId: string;
  let planId: string;
  let pct: string; // product-scoped 10%
  let sub: string; // subscription-scoped fixed

  beforeAll(async () => {
    prod = (await prisma.product.create({ data: { name: name("disc prod"), type: "SERVICE", salesPrice: 1000, costPrice: 1 } })).id;
    termId = (await prisma.paymentTerm.create({ data: { name: name("disc term"), dueDays: 5 } })).id;
    planId = (await prisma.plan.create({ data: { name: name("disc plan"), price: 1, billingPeriod: "MONTHLY", availableFrom: new Date("2020-01-01") } })).id;
  });

  const body = (over: object = {}) => ({ name: name("d"), type: "PERCENTAGE", value: "10", scope: "PRODUCT", startDate: "2020-01-01", productIds: [prod], ...over });

  it("creates product and subscription discounts with a readable status", async () => {
    const a = await post("/discounts", body({ usageLimit: 3 }), admin.token);
    expect(a.status).toBe(201);
    expect(a.body.discount).toMatchObject({ value: "10.00", scope: "PRODUCT", status: "active", usageLimit: 3, usedCount: 0, remainingUses: 3, products: [{ id: prod }], attachedSubscriptions: 0 });
    pct = a.body.discount.id;
    const b = await post("/discounts", { name: name("fixed"), type: "FIXED", value: "25", scope: "SUBSCRIPTION", startDate: "2020-01-01", minPurchaseAmount: "500" }, admin.token);
    expect(b.status).toBe(201);
    expect(b.body.discount).toMatchObject({ value: "25.00", minPurchaseAmount: "500.00", remainingUses: null, products: [] });
    sub = b.body.discount.id;
  });

  it("rejects values the database or the billing maths could not honour", async () => {
    const cases: [string, object][] = [
      ["zero value", { value: "0" }],
      ["negative value", { value: "-5" }],
      ["percentage over 100", { value: "150" }],
      ["end before start", { endDate: "2019-12-31" }],
      ["impossible date", { startDate: "2026-02-30" }],
      ["zero usage limit", { usageLimit: 0 }],
      ["huge usage limit", { usageLimit: 5_000_000_000 }],
      ["zero min quantity", { minQuantity: 0 }],
      ["product discount without products", { productIds: [] }],
      ["subscription discount with products", { scope: "SUBSCRIPTION" }],
      ["amount too large", { type: "FIXED", value: "12345678901" }],
    ];
    for (const [label, over] of cases) expect((await post("/discounts", body(over), admin.token)).status, label).toBe(400);
    expect((await post("/discounts", body({ productIds: [UNKNOWN] }), admin.token)).status).toBe(404);
  });

  it("filters by what is happening to it today, without breaking pagination", async () => {
    const mk = (over: object) => post("/discounts", body({ name: name("st"), ...over }), admin.token).then((r) => r.body.discount.id as string);
    const scheduled = await mk({ startDate: toDateOnly(addDays(today, 10)) });
    const expired = await mk({ startDate: "2020-01-01", endDate: toDateOnly(addDays(today, -1)) });
    const inactive = await mk({ isActive: false, productIds: [] });
    const exhausted = await mk({ usageLimit: 1 });
    await prisma.discount.update({ where: { id: exhausted }, data: { usedCount: 1 } });
    const find = async (status: string) => (await get(`/discounts?status=${status}&search=${TAG}&limit=100`, staff.token)).body.items.map((d: any) => d.id) as string[];
    expect(await find("scheduled")).toContain(scheduled);
    expect(await find("expired")).toContain(expired);
    expect(await find("inactive")).toContain(inactive);
    expect(await find("exhausted")).toContain(exhausted);
    const active = await find("active");
    expect(active).toContain(pct);
    for (const id of [scheduled, expired, inactive, exhausted]) expect(active).not.toContain(id);
    expect((await get("/discounts?status=weird", staff.token)).status).toBe(400);
  });

  it("validates updates against the row as it will be, including usage already consumed", async () => {
    await prisma.discount.update({ where: { id: pct }, data: { usedCount: 2 } });
    const low = await patch(`/discounts/${pct}`, { usageLimit: 1 }, admin.token);
    expect(low.status).toBe(409);
    expect(low.body.error.code).toBe("USAGE_BELOW_USED");
    expect((await patch(`/discounts/${pct}`, { usageLimit: 2 }, admin.token)).status).toBe(200); // exactly used: fine
    await prisma.discount.update({ where: { id: pct }, data: { usedCount: 0, usageLimit: 3 } });

    const fixedBig = (await post("/discounts", body({ name: name("big fixed"), type: "FIXED", value: "500" }), admin.token)).body.discount.id;
    expect((await patch(`/discounts/${fixedBig}`, { type: "PERCENTAGE" }, admin.token)).status).toBe(400); // 500% is nonsense
    expect((await patch(`/discounts/${pct}`, { endDate: "2019-01-01" }, admin.token)).status).toBe(400); // before start
    expect((await patch(`/discounts/${pct}`, {}, admin.token)).status).toBe(400);
    expect((await patch(`/discounts/${pct}`, { value: "12.5" }, admin.token)).body.discount.value).toBe("12.50");
    await patch(`/discounts/${pct}`, { value: "10" }, admin.token);
  });

  it("scope can't change underneath attachments; the last product of an active discount can't be removed", async () => {
    const r = await patch(`/discounts/${pct}`, { scope: "SUBSCRIPTION" }, admin.token);
    expect(r.body.error.code).toBe("SCOPE_CHANGE_BLOCKED");
    const last = await del(`/discounts/${pct}/products/${prod}`, admin.token);
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe("LAST_PRODUCT");

    const p2 = (await prisma.product.create({ data: { name: name("disc p2"), type: "SERVICE", salesPrice: 5, costPrice: 1 } })).id;
    const attached = await post(`/discounts/${pct}/products`, { productIds: [p2, p2, prod] }, admin.token); // duplicates are harmless
    expect(attached.body.discount.products).toHaveLength(2);
    expect((await del(`/discounts/${pct}/products/${prod}`, admin.token)).status).toBe(204);
    expect((await post(`/discounts/${pct}/products`, { productIds: [UNKNOWN] }, admin.token)).status).toBe(404);
    expect((await post(`/discounts/${sub}/products`, { productIds: [p2] }, admin.token)).status).toBe(400); // wrong scope
    await post(`/discounts/${pct}/products`, { productIds: [prod] }, admin.token);
    await del(`/discounts/${pct}/products/${p2}`, admin.token);
  });

  it("attaches subscription discounts to live subscriptions only, once", async () => {
    const s = await prisma.subscription.create({ data: { number: `ZZT-${TAG}-ds`, customerId: cust.customerId, planId, paymentTermId: termId, status: "DRAFT", startDate: today } });
    const closed = await prisma.subscription.create({ data: { number: `ZZT-${TAG}-dc`, customerId: cust.customerId, planId, paymentTermId: termId, status: "CLOSED", startDate: today } });

    expect((await post(`/discounts/${pct}/subscriptions`, { subscriptionId: s.id }, admin.token)).body.error.code).toBe("BAD_REQUEST"); // product-scoped
    const ok = await post(`/discounts/${sub}/subscriptions`, { subscriptionId: s.id }, admin.token);
    expect(ok.status).toBe(201);
    expect(ok.body.discount.attachedSubscriptions).toBe(1);
    expect((await post(`/discounts/${sub}/subscriptions`, { subscriptionId: s.id }, admin.token)).status).toBe(409);
    expect((await post(`/discounts/${sub}/subscriptions`, { subscriptionId: closed.id }, admin.token)).body.error.code).toBe("SUBSCRIPTION_CLOSED");
    expect((await post(`/discounts/${sub}/subscriptions`, { subscriptionId: UNKNOWN }, admin.token)).status).toBe(404);

    const listed = await get(`/discounts/for-subscription/${s.id}`, staff.token);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].discount.id).toBe(sub);
    expect((await patch(`/discounts/${sub}`, { scope: "PRODUCT" }, admin.token)).body.error.code).toBe("SCOPE_CHANGE_BLOCKED");

    expect((await del(`/discounts/${sub}/subscriptions/${s.id}`, admin.token)).status).toBe(204);
    expect((await get(`/discounts/for-subscription/${s.id}`, staff.token)).body.items).toHaveLength(0);
  });

  it("END TO END: a discount made through the API is applied by billing, reported, and released on cancel", async () => {
    // its own product: the other tests above leave live discounts on `prod`, and product discounts STACK
    const e2eProd = (await prisma.product.create({ data: { name: name("e2e prod"), type: "SERVICE", salesPrice: 1000, costPrice: 1 } })).id;
    const d = (await post("/discounts", body({ name: name("e2e"), value: "20", usageLimit: 5, productIds: [e2eProd] }), admin.token)).body.discount.id as string;
    const s = await prisma.subscription.create({
      data: {
        number: `ZZT-${TAG}-e2e`, customerId: cust.customerId, planId, paymentTermId: termId, status: "ACTIVE", startDate: today, nextBillingDate: today, activatedAt: new Date(),
        lines: { create: [{ productId: e2eProd, description: "x", quantity: 1, unitPrice: 1000, amount: 1000, sortOrder: 0 }] },
      },
    });
    const run = await prisma.billingRun.create({ data: { runDate: today, status: "RUNNING", triggeredBy: admin.userId } });
    const summary = await executeRun(run.id, { asOf: today, autoConfirm: false, concurrency: 1, maxInvoices: 10, only: [s.id] });
    expect(summary.invoiced).toBe(1);

    const detail = (await get(`/discounts/${d}`, staff.token)).body.discount;
    expect(detail).toMatchObject({ usedCount: 1, remainingUses: 4, redemptions: 1 });
    const reds = await get(`/discounts/${d}/redemptions`, staff.token);
    expect(reds.body.total).toBe(1);
    expect(reds.body.items[0]).toMatchObject({ amount: "200.00", subscription: { id: s.id }, customer: { id: cust.customerId } });

    const inv = await prisma.invoice.findFirstOrThrow({ where: { subscriptionId: s.id } });
    expect(inv.discountTotal.toFixed(2)).toBe("200.00");
    await post(`/invoices/${inv.id}/cancel`, { reason: "test" }, admin.token);
    expect((await get(`/discounts/${d}`, staff.token)).body.discount).toMatchObject({ usedCount: 0, redemptions: 0 });
  });

  it("deleting a discount stops it applying; the rest of the API treats it as gone", async () => {
    const d = (await post("/discounts", body({ name: name("to delete"), value: "50" }), admin.token)).body.discount.id as string;
    expect((await del(`/discounts/${d}`, staff.token)).status).toBe(403);
    expect((await del(`/discounts/${d}`, admin.token)).status).toBe(204);
    expect((await get(`/discounts/${d}`, staff.token)).status).toBe(404);
    expect((await del(`/discounts/${d}`, admin.token)).status).toBe(404);
    expect((await get(`/discounts?search=${TAG}&limit=100`, staff.token)).body.items.map((x: any) => x.id)).not.toContain(d);
  });
});
