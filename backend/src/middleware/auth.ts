import type { RequestHandler } from "express";
import type { Role } from "../generated/prisma/client.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/security.js";

export interface AuthContext {
  userId: string;
  role: Role;
  /** Set for CUSTOMER users. Customer-facing queries MUST filter by this. */
  customerId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** Requires a valid `Authorization: Bearer <access token>`. Stateless (no DB hit). */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(unauthorized());
  try {
    const c = verifyAccessToken(header.slice(7));
    req.auth = { userId: c.sub, role: c.role, customerId: c.cid };
    next();
  } catch {
    next(unauthorized("Invalid or expired token"));
  }
};

/** Usage: router.post("/", authenticate, requireRole("ADMIN"), handler) */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };

export const requireStaff = requireRole("ADMIN", "STAFF");

/** Convenience for handlers after `authenticate`. */
export function auth(req: Express.Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
