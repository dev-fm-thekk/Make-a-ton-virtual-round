import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createTaxSchema,
  updateTaxSchema,
  listTaxesQuery,
  createProductSchema,
  updateProductSchema,
  listProductsQuery,
  createVariantSchema,
  updateVariantSchema,
  createPaymentTermSchema,
  updatePaymentTermSchema,
  listPaymentTermsQuery,
} from "./catalog.schemas.js";
import * as svc from "./catalog.service.js";

export const catalogRouter = Router();

// Base auth requirement: all endpoints require authentication
catalogRouter.use(authenticate);

// ==========================================
// 1. TAXES (/taxes)
// Access: Staff/Admin read; Admin write
// ==========================================

const taxRouter = Router();

taxRouter.get("/", requireStaff, validate({ query: listTaxesQuery }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listTaxesQuery>;
  const result = await svc.listTaxes(query);
  res.json(result);
});

taxRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  const tax = await svc.getTaxById(req.params.id as string);
  res.json({ tax });
});

taxRouter.post("/", requireRole("ADMIN"), validate({ body: createTaxSchema }), async (req, res) => {
  const tax = await svc.createTax(req.body);
  await audit(req, { action: "tax.create", entityType: "Tax", entityId: tax.id, metadata: req.body });
  res.status(201).json({ tax });
});

taxRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updateTaxSchema }), async (req, res) => {
  const id = req.params.id as string;
  const tax = await svc.updateTax(id, req.body);
  await audit(req, { action: "tax.update", entityType: "Tax", entityId: id, metadata: req.body });
  res.json({ tax });
});

taxRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteTax(id);
  await audit(req, { action: "tax.delete", entityType: "Tax", entityId: id });
  res.status(204).end();
});

// ==========================================
// 2. PRODUCTS (/products)
// Access: Staff/Admin read; Admin write
// ==========================================

const productRouter = Router();

productRouter.get("/", requireStaff, validate({ query: listProductsQuery }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listProductsQuery>;
  const result = await svc.listProducts(query);
  res.json(result);
});

productRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  const product = await svc.getProductById(req.params.id as string);
  res.json({ product });
});

productRouter.post("/", requireRole("ADMIN"), validate({ body: createProductSchema }), async (req, res) => {
  const product = await svc.createProduct(req.body);
  await audit(req, { action: "product.create", entityType: "Product", entityId: product.id, metadata: req.body });
  res.status(201).json({ product });
});

productRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updateProductSchema }), async (req, res) => {
  const id = req.params.id as string;
  const product = await svc.updateProduct(id, req.body);
  await audit(req, { action: "product.update", entityType: "Product", entityId: id, metadata: req.body });
  res.json({ product });
});

productRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteProduct(id);
  await audit(req, { action: "product.delete", entityType: "Product", entityId: id });
  res.status(204).end();
});

// Variants under /products/:id/variants
const variantParam = z.object({ id: z.string().uuid(), variantId: z.string().uuid() });

productRouter.get("/:id/variants", requireStaff, validate({ params: idParam }), async (req, res) => {
  const variants = await svc.listProductVariants(req.params.id as string);
  res.json({ items: variants });
});

productRouter.post("/:id/variants", requireRole("ADMIN"), validate({ params: idParam, body: createVariantSchema }), async (req, res) => {
  const productId = req.params.id as string;
  const variant = await svc.createProductVariant(productId, req.body);
  await audit(req, {
    action: "product_variant.create",
    entityType: "ProductVariant",
    entityId: variant.id,
    metadata: { productId, ...req.body },
  });
  res.status(201).json({ variant });
});

productRouter.patch("/:id/variants/:variantId", requireRole("ADMIN"), validate({ params: variantParam, body: updateVariantSchema }), async (req, res) => {
  const { id: productId, variantId } = req.params as { id: string; variantId: string };
  const variant = await svc.updateProductVariant(productId, variantId, req.body);
  await audit(req, {
    action: "product_variant.update",
    entityType: "ProductVariant",
    entityId: variantId,
    metadata: { productId, ...req.body },
  });
  res.json({ variant });
});

productRouter.delete("/:id/variants/:variantId", requireRole("ADMIN"), validate({ params: variantParam }), async (req, res) => {
  const { id: productId, variantId } = req.params as { id: string; variantId: string };
  await svc.deleteProductVariant(productId, variantId);
  await audit(req, {
    action: "product_variant.delete",
    entityType: "ProductVariant",
    entityId: variantId,
    metadata: { productId },
  });
  res.status(204).end();
});

// ==========================================
// 3. PAYMENT TERMS (/payment-terms)
// Access: Staff/Admin read; Admin write
// ==========================================

const paymentTermRouter = Router();

paymentTermRouter.get("/", requireStaff, validate({ query: listPaymentTermsQuery }), async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listPaymentTermsQuery>;
  const result = await svc.listPaymentTerms(query);
  res.json(result);
});

paymentTermRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  const paymentTerm = await svc.getPaymentTermById(req.params.id as string);
  res.json({ paymentTerm });
});

paymentTermRouter.post("/", requireRole("ADMIN"), validate({ body: createPaymentTermSchema }), async (req, res) => {
  const paymentTerm = await svc.createPaymentTerm(req.body);
  await audit(req, { action: "payment_term.create", entityType: "PaymentTerm", entityId: paymentTerm.id, metadata: req.body });
  res.status(201).json({ paymentTerm });
});

paymentTermRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updatePaymentTermSchema }), async (req, res) => {
  const id = req.params.id as string;
  const paymentTerm = await svc.updatePaymentTerm(id, req.body);
  await audit(req, { action: "payment_term.update", entityType: "PaymentTerm", entityId: id, metadata: req.body });
  res.json({ paymentTerm });
});

paymentTermRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.deletePaymentTerm(id);
  await audit(req, { action: "payment_term.delete", entityType: "PaymentTerm", entityId: id });
  res.status(204).end();
});

// Mount sub-routers on the catalogRouter:
// Allows mounting either at top-level v1 router or as a group
export { taxRouter, productRouter, paymentTermRouter };

catalogRouter.use("/taxes", taxRouter);
catalogRouter.use("/products", productRouter);
catalogRouter.use("/payment-terms", paymentTermRouter);
