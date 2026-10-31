// Shared helpers for integration tests (real HTTP against the real app + real database).
// SAFETY: refuses to run unless ALLOW_DB_TESTS=1. Everything created is tagged and deleted afterwards.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/security.js";

if (process.env.ALLOW_DB_TESTS !== "1") {
  throw new Error("Integration tests write to the database in .env. Re-run with ALLOW_DB_TESTS=1 (npm run test:integration does this).");
}

export const TAG = `zzt${Date.now().toString(36)}`;
export const PASSWORD = "Test!Passw0rd1";
export const email = (label: string) => `${TAG}-${label}@example.test`;

let server: Server;
let base = "";

export async function startServer() {
  server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
}

export async function stopServer() {
  await new Promise<void>((r) => server.close(() => r()));
}

export interface Res<T = any> {
  status: number;
  body: T;
}

export async function call<T = any>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Res<T>> {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(opts.token && { authorization: `Bearer ${opts.token}` }) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

export const get = <T = any>(path: string, token?: string) => call<T>("GET", path, { token });
export const post = <T = any>(path: string, body?: unknown, token?: string) => call<T>("POST", path, { token, body });
export const patch = <T = any>(path: string, body: unknown, token?: string) => call<T>("PATCH", path, { token, body });
export const put = <T = any>(path: string, body: unknown, token?: string) => call<T>("PUT", path, { token, body });

export async function createStaffUser(label: string, role: "ADMIN" | "STAFF") {
  const e = email(label);
  await prisma.user.create({ data: { email: e, name: `${TAG} ${label}`, passwordHash: await hashPassword(PASSWORD), role } });
  const r = await post("/auth/login", { email: e, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${e}: ${JSON.stringify(r.body)}`);
  return { email: e, token: r.body.accessToken as string, userId: r.body.user.id as string };
}

/** Registers through the real endpoint so the portal user + linked customer exist exactly as in production. */
export async function registerCustomer(label: string) {
  const e = email(label);
  const r = await post("/auth/register", { name: `${TAG} ${label}`, email: e, password: PASSWORD, companyName: `${TAG} Co ${label}` });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  return { email: e, token: r.body.accessToken as string, userId: r.body.user.id as string, customerId: r.body.user.customerId as string };
}

/** Delete everything any run of these tests created (tag prefix `zzt`), children before parents. */
export async function cleanup() {
  const customers = await prisma.customer.findMany({ where: { OR: [{ email: { startsWith: "zzt" } }, { name: { startsWith: "zzt" } }] }, select: { id: true } });
  const customerIds = customers.map((c) => c.id);
  const users = await prisma.user.findMany({ where: { email: { startsWith: "zzt" } }, select: { id: true } });
  const userIds = users.map((u) => u.id);

  const invoices = await prisma.invoice.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const invoiceIds = invoices.map((i) => i.id);
  const subs = await prisma.subscription.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const subIds = subs.map((s) => s.id);

  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.discountRedemption.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } }); // lines cascade
  await prisma.subscription.deleteMany({ where: { id: { in: subIds } } }); // lines / history cascade
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: [...customerIds, ...subIds, ...userIds] } }] } });
  await prisma.quotationTemplate.deleteMany({ where: { name: { startsWith: "ZZT" } } }); // lines cascade
  await prisma.plan.deleteMany({ where: { name: { startsWith: "ZZT" } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: "ZZT" } } }); // variants cascade
  await prisma.tax.deleteMany({ where: { name: { startsWith: "ZZT" } } });
  await prisma.paymentTerm.deleteMany({ where: { name: { startsWith: "ZZT" } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }); // tokens cascade
}

export async function disconnect() {
  await prisma.$disconnect();
}
