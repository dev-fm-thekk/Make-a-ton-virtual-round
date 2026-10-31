import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { isProd } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { Prisma } from "../generated/prisma/client.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` } });
};

// One place that turns every failure into the same JSON envelope: { error: { code, message, details? } }
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.flatten() } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "CONFLICT", message: "A record with these values already exists" } });
      return;
    }
    if (err.code === "P2003") {
      // A foreign key still points at this record (backstop: services check usage first and give a precise message).
      res.status(409).json({ error: { code: "IN_USE", message: "This record is still referenced by other records, so it can't be removed or changed this way" } });
      return;
    }
    if (err.code === "P2000" || err.code === "P2020") {
      res.status(400).json({ error: { code: "VALUE_OUT_OF_RANGE", message: "A value is too long or too large" } });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found" } });
      return;
    }
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL", message: isProd ? "Internal server error" : String((err as Error)?.message ?? err) },
  });
};
