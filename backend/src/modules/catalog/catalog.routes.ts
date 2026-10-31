import { Router } from "express";
import { z } from "zod";
import { audit } from "../../lib/audit.js";
import { idParam } from "../../lib/shared.js";
import { authenticate, requireRole, requireStaff } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createPaymentTermSchema,
  createProductSchema,
  createTaxSchema,
  createVariantSchema,
  listPaymentTermsQuery,
  listProductsQuery,
  listTaxesQuery,
  updatePaymentTermSchema,
  updateProductSchema,
  updateTaxSchema,
  updateVariantSchema,
} from "./catalog.schemas.js";
import * as svc from "./catalog.service.js";

// Access (all three): staff read, admin write. Each router authenticates itself, so mounting any of them anywhere
// can never leave a route open (or accidentally put a login wall in front of public ones).

const query = <T extends z.ZodType>(req: { query: unknown }) => req.query as z.output<T>;

// ───────── /taxes ─────────
export const taxesRouter = Router();
taxesRouter.use(authenticate);

taxesRouter.get("/", requireStaff, validate({ query: listTaxesQuery }), async (req, res) => {
  res.json(await svc.listTaxes(query<typeof listTaxesQuery>(req)));
});
taxesRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json({ tax: await svc.getTaxById(req.params.id as string) });
});
taxesRouter.post("/", requireRole("ADMIN"), validate({ body: createTaxSchema }), async (req, res) => {
  const tax = await svc.createTax(req.body);
  await audit(req, { action: "tax.create", entityType: "Tax", entityId: tax.id, metadata: { name: tax.name, ratePercent: tax.ratePercent } });
  res.status(201).json({ tax });
});
taxesRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updateTaxSchema }), async (req, res) => {
  const id = req.params.id as string;
  const tax = await svc.updateTax(id, req.body);
  await audit(req, { action: "tax.update", entityType: "Tax", entityId: id, metadata: req.body });
  res.json({ tax });
});
taxesRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteTax(id);
  await audit(req, { action: "tax.delete", entityType: "Tax", entityId: id });
  res.status(204).end();
});

// ───────── /products (+ /variants) ─────────
export const productsRouter = Router();
productsRouter.use(authenticate);

productsRouter.get("/", requireStaff, validate({ query: listProductsQuery }), async (req, res) => {
  res.json(await svc.listProducts(query<typeof listProductsQuery>(req)));
});
productsRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json({ product: await svc.getProductById(req.params.id as string) });
});
productsRouter.post("/", requireRole("ADMIN"), validate({ body: createProductSchema }), async (req, res) => {
  const product = await svc.createProduct(req.body);
  await audit(req, { action: "product.create", entityType: "Product", entityId: product.id, metadata: { name: product.name, salesPrice: product.salesPrice } });
  res.status(201).json({ product });
});
productsRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updateProductSchema }), async (req, res) => {
  const id = req.params.id as string;
  const product = await svc.updateProduct(id, req.body);
  await audit(req, { action: "product.update", entityType: "Product", entityId: id, metadata: req.body });
  res.json({ product });
});
productsRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.softDeleteProduct(id);
  await audit(req, { action: "product.delete", entityType: "Product", entityId: id });
  res.status(204).end();
});

const variantParams = z.object({ id: z.string().uuid(), variantId: z.string().uuid() });

productsRouter.get("/:id/variants", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json({ items: await svc.listProductVariants(req.params.id as string) });
});
productsRouter.post("/:id/variants", requireRole("ADMIN"), validate({ params: idParam, body: createVariantSchema }), async (req, res) => {
  const productId = req.params.id as string;
  const variant = await svc.createProductVariant(productId, req.body);
  await audit(req, { action: "product_variant.create", entityType: "ProductVariant", entityId: variant.id, metadata: { productId, attribute: variant.attribute, value: variant.value } });
  res.status(201).json({ variant });
});
productsRouter.patch("/:id/variants/:variantId", requireRole("ADMIN"), validate({ params: variantParams, body: updateVariantSchema }), async (req, res) => {
  const { id: productId, variantId } = req.params as { id: string; variantId: string };
  const variant = await svc.updateProductVariant(productId, variantId, req.body);
  await audit(req, { action: "product_variant.update", entityType: "ProductVariant", entityId: variantId, metadata: { productId, ...req.body } });
  res.json({ variant });
});
productsRouter.delete("/:id/variants/:variantId", requireRole("ADMIN"), validate({ params: variantParams }), async (req, res) => {
  const { id: productId, variantId } = req.params as { id: string; variantId: string };
  await svc.deleteProductVariant(productId, variantId);
  await audit(req, { action: "product_variant.delete", entityType: "ProductVariant", entityId: variantId, metadata: { productId } });
  res.status(204).end();
});

// ───────── /payment-terms ─────────
export const paymentTermsRouter = Router();
paymentTermsRouter.use(authenticate);

paymentTermsRouter.get("/", requireStaff, validate({ query: listPaymentTermsQuery }), async (req, res) => {
  res.json(await svc.listPaymentTerms(query<typeof listPaymentTermsQuery>(req)));
});
paymentTermsRouter.get("/:id", requireStaff, validate({ params: idParam }), async (req, res) => {
  res.json({ paymentTerm: await svc.getPaymentTermById(req.params.id as string) });
});
paymentTermsRouter.post("/", requireRole("ADMIN"), validate({ body: createPaymentTermSchema }), async (req, res) => {
  const paymentTerm = await svc.createPaymentTerm(req.body);
  await audit(req, { action: "payment_term.create", entityType: "PaymentTerm", entityId: paymentTerm.id, metadata: req.body });
  res.status(201).json({ paymentTerm });
});
paymentTermsRouter.patch("/:id", requireRole("ADMIN"), validate({ params: idParam, body: updatePaymentTermSchema }), async (req, res) => {
  const id = req.params.id as string;
  const paymentTerm = await svc.updatePaymentTerm(id, req.body);
  await audit(req, { action: "payment_term.update", entityType: "PaymentTerm", entityId: id, metadata: req.body });
  res.json({ paymentTerm });
});
paymentTermsRouter.delete("/:id", requireRole("ADMIN"), validate({ params: idParam }), async (req, res) => {
  const id = req.params.id as string;
  await svc.deletePaymentTerm(id);
  await audit(req, { action: "payment_term.delete", entityType: "PaymentTerm", entityId: id });
  res.status(204).end();
});
