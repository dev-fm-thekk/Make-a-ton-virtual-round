import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createDiscountSchema,
  updateDiscountSchema,
  listDiscountsQuery,
  attachDiscountProductsSchema,
  attachSubscriptionDiscountSchema,
} from "./discounts.schemas.js";
import * as svc from "./discounts.service.js";

export const discountsRouter = Router();

// Base auth requirement: all discount management is ADMIN-only
discountsRouter.use(authenticate, requireRole("ADMIN"));

// ==========================================
// 1. DISCOUNT CRUD (/discounts)
// Access: ADMIN
// ==========================================

discountsRouter.get("/", validate({ query: listDiscountsQuery }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listDiscountsQuery>;
  const result = await svc.listDiscounts(query);
  res.json(result);
});

discountsRouter.get("/:id", validate({ params: idParam }), async (req, res) => {
  const discount = await svc.getDiscountById(req.params.id as string);
  res.json({ discount });
});

discountsRouter.post("/", validate({ body: createDiscountSchema }), async (req, res) => {
  const discount = await svc.createDiscount(req.body);
  await audit(req, {
    action: "discount.create",
    entityType: "Discount",
    entityId: discount.id,
    metadata: { name: req.body.name, type: req.body.type, value: req.body.value, scope: req.body.scope },
  });
  res.status(201).json({ discount });
});

discountsRouter.patch("/:id", validate({ params: idParam, body: updateDiscountSchema }), async (req, res) => {
  const id = req.params.id as string;
  const discount = await svc.updateDiscount(id, req.body);
  await audit(req, {
    action: "discount.update",
    entityType: "Discount",
    entityId: id,
    metadata: req.body,
  });
  res.json({ discount });
});

discountsRouter.delete("/:id", validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteDiscount(id);
  await audit(req, {
    action: "discount.delete",
    entityType: "Discount",
    entityId: id,
  });
  res.status(204).end();
});

// ==========================================
// 2. ATTACH TO PRODUCTS (/discounts/:id/products)
// Access: ADMIN
// ==========================================

const productParam = z.object({ id: z.string().uuid(), productId: z.string().uuid() });

discountsRouter.post("/:id/products", validate({ params: idParam, body: attachDiscountProductsSchema }), async (req, res) => {
  const id = req.params.id as string;
  const discount = await svc.attachProductsToDiscount(id, req.body.productIds);
  await audit(req, {
    action: "discount.attach_products",
    entityType: "Discount",
    entityId: id,
    metadata: { productIds: req.body.productIds },
  });
  res.json({ discount });
});

discountsRouter.delete("/:id/products/:productId", validate({ params: productParam }), async (req, res) => {
  const { id, productId } = req.params as { id: string; productId: string };
  await svc.detachProductFromDiscount(id, productId);
  await audit(req, {
    action: "discount.detach_product",
    entityType: "Discount",
    entityId: id,
    metadata: { productId },
  });
  res.status(204).end();
});

// ==========================================
// 3. ATTACH TO SUBSCRIPTIONS (/discounts/:id/subscriptions)
// Access: ADMIN
// ==========================================

const subParam = z.object({ id: z.string().uuid(), subscriptionId: z.string().uuid() });

discountsRouter.post("/:id/subscriptions", validate({ params: idParam, body: attachSubscriptionDiscountSchema }), async (req, res) => {
  const id = req.params.id as string;
  const subDiscount = await svc.attachDiscountToSubscription(id, req.body.subscriptionId);
  await audit(req, {
    action: "discount.attach_subscription",
    entityType: "SubscriptionDiscount",
    entityId: id,
    metadata: { subscriptionId: req.body.subscriptionId },
  });
  res.status(201).json({ subscriptionDiscount: subDiscount });
});

discountsRouter.delete("/:id/subscriptions/:subscriptionId", validate({ params: subParam }), async (req, res) => {
  const { id, subscriptionId } = req.params as { id: string; subscriptionId: string };
  await svc.detachDiscountFromSubscription(id, subscriptionId);
  await audit(req, {
    action: "discount.detach_subscription",
    entityType: "SubscriptionDiscount",
    entityId: id,
    metadata: { subscriptionId },
  });
  res.status(204).end();
});
