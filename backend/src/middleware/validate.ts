import type { RequestHandler } from "express";
import type { ZodType } from "zod";

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and REPLACES req.body / req.query / req.params with the parsed (typed, stripped) values.
 * ZodErrors are turned into a 400 by the central error handler.
 *   router.post("/", validate({ body: createSchema }), handler)
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) Object.defineProperty(req, "params", { value: schemas.params.parse(req.params), writable: true });
      if (schemas.query) Object.defineProperty(req, "query", { value: schemas.query.parse(req.query), writable: true });
      next();
    } catch (err) {
      next(err);
    }
  };
