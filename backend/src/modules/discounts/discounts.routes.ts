import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { idParam, paginationQuery, type Pagination } from "../../lib/shared.js";
import { authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  attachDiscountProductsSchema,
  attachSubscriptionDiscountSchema,
  createDiscountSchema,
  listDiscountsQuery,
  updateDiscountSchema,
  type ListDiscountsQuery,
} from "./discounts.schemas.js";
import * as svc from "./discounts.service.js";

/**
 * /discounts. The brief: only the admin creates discount rules, so every write is ADMIN-only. Staff may READ them
 * (to see what a customer already gets and why an invoice is discounted).
 */
export const discountsRouter = Router();
discountsRouter.use(authenticate);

const productParams = z.object({ id: z.string().uuid(), productId: z.string().uuid() });
const subscriptionParams = z.object({ id: z.string().uuid(), subscriptionId: z.string().uuid() });

// ── reads (staff + admin). Declared before "/:id" so literal segments are never read as an id. ──
discountsRouter.get("/", requireStaff, validate({ query: listDiscountsQuery }), async (req, res) => {
  res.json(await svc.listDiscounts(req.query as unknown as ListDiscountsQuery));
});

discountsRouter.get("/for-subscription/:subscriptionId", requireStaff, validate({ params: z.object({ subscriptionId: z.string().uuid() }) }), async (req, res) => {
  res.json({ items: await svc.discountsForSubscription(req.params.subscriptionId as string) });
});

discountsRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json({ discount: await svc.getDiscountById(req.params.id as string) });
});

discountsRouter.get("/:id/redemptions", requireStaff, validate({ params: idParam, query: paginationQuery }), async (req, res) => {
  res.json(await svc.listRedemptions(req.params.id as string, req.query as unknown as Pagination));
});

// ── writes (admin) ──
discountsRouter.post("/", requireRole("ADMIN"), validate({ body: createDiscountSchema }), async (req, res) => {
  const discount = await svc.createDiscount(req.body);
  await audit(req, { action: "discount.create", entityType: "Discount", entityId: discount.id, metadata: { name: discount.name, type: discount.type, value: discount.value, scope: discount.scope } });
  res.status(201).json({ discount });
});

discountsRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updateDiscountSchema }), async (req, res) => {
  const id = req.params.id as string;
  const discount = await svc.updateDiscount(id, req.body);
  await audit(req, { action: "discount.update", entityType: "Discount", entityId: id, metadata: req.body });
  res.json({ discount });
});

discountsRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteDiscount(id);
  await audit(req, { action: "discount.delete", entityType: "Discount", entityId: id });
  res.status(204).end();
});

discountsRouter.post("/:id/products", requireRole("ADMIN"), validate({ params: idParam, body: attachDiscountProductsSchema }), async (req, res) => {
  const id = req.params.id as string;
  const discount = await svc.attachProductsToDiscount(id, req.body.productIds);
  await audit(req, { action: "discount.attach_products", entityType: "Discount", entityId: id, metadata: { productIds: req.body.productIds } });
  res.json({ discount });
});

discountsRouter.delete("/:id/products/:productId", requireRole("ADMIN"), validate({ params: productParams }), async (req, res) => {
  const { id, productId } = req.params as { id: string; productId: string };
  await svc.detachProductFromDiscount(id, productId);
  await audit(req, { action: "discount.detach_product", entityType: "Discount", entityId: id, metadata: { productId } });
  res.status(204).end();
});

discountsRouter.post("/:id/subscriptions", requireRole("ADMIN"), validate({ params: idParam, body: attachSubscriptionDiscountSchema }), async (req, res) => {
  const id = req.params.id as string;
  const discount = await svc.attachDiscountToSubscription(id, req.body.subscriptionId);
  await audit(req, { action: "discount.attach_subscription", entityType: "Discount", entityId: id, metadata: { subscriptionId: req.body.subscriptionId } });
  res.status(201).json({ discount });
});

discountsRouter.delete("/:id/subscriptions/:subscriptionId", requireRole("ADMIN"), validate({ params: subscriptionParams }), async (req, res) => {
  const { id, subscriptionId } = req.params as { id: string; subscriptionId: string };
  await svc.detachDiscountFromSubscription(id, subscriptionId);
  await audit(req, { action: "discount.detach_subscription", entityType: "Discount", entityId: id, metadata: { subscriptionId } });
  res.status(204).end();
});
