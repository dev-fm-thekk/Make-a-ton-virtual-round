import { Router } from "express";
import { z } from "zod";
import { conflict } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword, passwordSchema } from "../../lib/security.js";
import { idParam, pageArgs, pageResult, paginationQuery } from "../../lib/shared.js";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { auth } from "../../middleware/auth.js";
import { notFound, badRequest } from "../../lib/errors.js";

export const usersRouter = Router();

// All user management is ADMIN-only. ("Only the admin can add a new member of staff.")
usersRouter.use(authenticate, requireRole("ADMIN"));

const select = { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true } as const;

const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
});

usersRouter.post("/staff", validate({ body: createStaffSchema }), async (req, res) => {
  const passwordHash = await hashPassword(req.body.password);
  try {
    const user = await prisma.user.create({
      data: { email: req.body.email, name: req.body.name, passwordHash, role: "STAFF", createdById: auth(req).userId },
      select,
    });
    await audit(req, { action: "user.create_staff", entityType: "User", entityId: user.id });
    res.status(201).json({ user });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw conflict("An account with this email already exists");
    throw err;
  }
});

const listQuery = paginationQuery.extend({
  role: z.enum(["ADMIN", "STAFF", "CUSTOMER"]).optional(),
  search: z.string().trim().max(100).optional(),
});

usersRouter.get("/", validate({ query: listQuery }), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQuery>;
  const where = {
    role: q.role,
    ...(q.search && { OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { email: { contains: q.search.toLowerCase() } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select, orderBy: { createdAt: "desc" }, ...pageArgs(q) }),
    prisma.user.count({ where }),
  ]);
  res.json(pageResult(items, total, q));
});

const patchSchema = z.object({ isActive: z.boolean().optional(), name: z.string().trim().min(1).max(120).optional() });

usersRouter.patch("/:id", validate({ params: idParam, body: patchSchema }), async (req, res) => {
  const id = req.params.id as string;
  if (id === auth(req).userId && req.body.isActive === false) throw badRequest("You cannot deactivate your own account");
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound("User");
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data: req.body, select });
    if (req.body.isActive === false) {
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return u;
  });
  await audit(req, { action: "user.update", entityType: "User", entityId: id, metadata: req.body });
  res.json({ user });
});
