import { env } from "../../config/env.js";
import type { Role, User } from "../../generated/prisma/client.js";
import { conflict, unauthorized, badRequest } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import {
  DUMMY_HASH,
  hashPassword,
  newFamilyId,
  newOpaqueToken,
  sha256,
  signAccessToken,
  verifyPassword,
} from "../../lib/security.js";
import { sendMailBackground } from "../../lib/mailer.js";
import type { Tx } from "../../lib/shared.js";

const DAY_MS = 86_400_000;

interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

export type PublicUser = Pick<User, "id" | "email" | "name" | "role"> & { customerId?: string };

const toPublic = (u: User, customerId?: string): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  customerId,
});

async function customerIdFor(userId: string, role: Role, tx: Tx = prisma): Promise<string | undefined> {
  if (role !== "CUSTOMER") return undefined;
  const c = await tx.customer.findUnique({ where: { userId }, select: { id: true } });
  return c?.id;
}

async function issueSession(user: User, meta: ClientMeta, familyId: string = newFamilyId()): Promise<Session> {
  const customerId = await customerIdFor(user.id, user.role);
  const refreshToken = newOpaqueToken();
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), familyId, expiresAt: refreshExpiresAt, ...meta },
  });
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, cid: customerId }),
    refreshToken,
    refreshExpiresAt,
    user: toPublic(user, customerId),
  };
}

// ───────── register (customers only; staff are created by an admin) ─────────
export async function register(
  input: { name: string; email: string; password: string; companyName?: string; phone?: string },
  meta: ClientMeta,
): Promise<Session> {
  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash, role: "CUSTOMER" },
      });
      await tx.customer.create({
        data: { userId: u.id, name: input.name, email: input.email, companyName: input.companyName, phone: input.phone },
      });
      return u;
    });
  } catch (err) {
    // Unique violation on users.email → one account per email. The DB is the source of truth (no check-then-insert race).
    if ((err as { code?: string }).code === "P2002") throw conflict("An account with this email already exists");
    throw err;
  }
  return issueSession(user, meta);
}

// ───────── login ─────────
export async function login(input: { email: string; password: string }, meta: ClientMeta): Promise<Session> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Always run one argon2 verify so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, input.password);
  if (!user || !ok || !user.isActive) throw unauthorized("Invalid email or password");
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return issueSession(user, meta);
}

// ───────── refresh (rotation + reuse detection) ─────────
export async function refresh(rawToken: string, meta: ClientMeta): Promise<Session> {
  const hash = sha256(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
  if (!existing) throw unauthorized("Invalid refresh token");

  if (existing.revokedAt) {
    // A rotated-out token is being replayed → assume theft, kill the whole family.
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized("Refresh token reuse detected");
  }
  if (existing.expiresAt < new Date() || !existing.user.isActive) throw unauthorized("Session expired");

  // Atomically claim the token: if two requests race, only one wins.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) throw unauthorized("Refresh token already used");

  return issueSession(existing.user, meta, existing.familyId);
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const t = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (t) {
    await prisma.refreshToken.updateMany({ where: { familyId: t.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

// ───────── forgot / reset password ─────────
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return; // caller always answers 200 → no account enumeration

  const token = newOpaqueToken();
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }), // invalidate older links
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000) },
    }),
  ]);

  const link = `${env.APP_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const minutes = env.PASSWORD_RESET_TTL_MINUTES;
  const expiryText = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hour${minutes / 60 > 1 ? "s" : ""}` : `${minutes} minutes`;
  sendMailBackground({
    to: user.email,
    subject: "Reset your password",
    text:
      `Hi ${user.name},\n\nUse the link below to reset your password. It expires in ${expiryText}.\n\n${link}\n\n` +
      `If you didn't request this, you can ignore this email.`,
    html:
      `<p>Hi ${escapeHtml(user.name)},</p><p>Use the link below to reset your password. It expires in ${expiryText}.</p>` +
      `<p><a href="${link}">Reset password</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // Single-use: claim the token atomically.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash: sha256(token), usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw badRequest("Reset link is invalid or has expired");
    const row = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    // Log out everywhere.
    await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  });
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current))) throw badRequest("Current password is incorrect");
  const passwordHash = await hashPassword(next);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function me(userId: string): Promise<PublicUser> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || !u.isActive) throw unauthorized();
  return toPublic(u, await customerIdFor(u.id, u.role));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
