import { Router } from "express";
import { Prisma } from "../../generated/prisma/client.js";
import { auth, authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { idParam } from "../../lib/shared.js";
import {
  createCustomerSchema,
  listCustomersQuery,
  updateCustomerSchema,
  updateOwnProfileSchema,
  type ListCustomersQuery,
} from "./customers.schemas.js";
import * as svc from "./customers.service.js";

/** JSON columns can't be set to a bare `null` in Prisma; map it to a real SQL NULL. */
function jsonNulls<T extends Record<string, unknown>>(patch: T): T {
  const out: Record<string, unknown> = { ...patch };
  if (out.billingAddress === null) out.billingAddress = Prisma.DbNull;
  return out as T;
}

// ───────── /customers  (ADMIN + STAFF) ─────────
export const customersRouter = Router();
customersRouter.use(authenticate, requireStaff);

customersRouter.get("/", validate({ query: listCustomersQuery }), async (req, res) => {
  res.json(await svc.listCustomers(req.query as unknown as ListCustomersQuery));
});

customersRouter.post("/", validate({ body: createCustomerSchema }), async (req, res) => {
  res.status(201).json({ customer: await svc.createCustomer(req, req.body) });
});

customersRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  res.json({ customer: await svc.getCustomer(req.params.id as string) });
});

customersRouter.patch("/:id", validate({ params: idParam, body: updateCustomerSchema }), async (req, res) => {
  res.json({ customer: await svc.updateCustomer(req, req.params.id as string, jsonNulls(req.body)) });
});

// Deleting customers is destructive enough to be admin-only.
customersRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  await svc.deleteCustomer(req, req.params.id as string);
  res.status(204).end();
});

// ───────── /me/profile  (CUSTOMER self-service) ─────────
export const meRouter = Router();
meRouter.use(authenticate, requireRole("CUSTOMER"));

meRouter.get("/profile", async (req, res) => {
  res.json({ profile: await svc.getOwnProfile(auth(req).customerId) });
});

meRouter.patch("/profile", validate({ body: updateOwnProfileSchema }), async (req, res) => {
  res.json({ profile: await svc.updateOwnProfile(req, auth(req).customerId, jsonNulls(req.body)) });
});
