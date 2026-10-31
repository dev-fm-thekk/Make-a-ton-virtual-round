import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import type { Role } from "../generated/prisma/client.js";

// ───────── passwords ─────────
// OWASP argon2id baseline.
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => argon2.hash(plain, ARGON_OPTS);
export const verifyPassword = (hash: string, plain: string) => argon2.verify(hash, plain).catch(() => false);

/** Brief: more than 8 chars, an uppercase, a lowercase and a special character. */
export const passwordSchema = z
  .string()
  .min(9, "Password must be more than 8 characters")
  .max(128)
  .regex(/[A-Z]/, "Password needs an uppercase letter")
  .regex(/[a-z]/, "Password needs a lowercase letter")
  .regex(/[^A-Za-z0-9]/, "Password needs a special character");

// Verified against when the email doesn't exist, so login timing doesn't reveal valid emails.
export const DUMMY_HASH = await hashPassword("dummy-Password-for-timing!");

// ───────── opaque tokens (refresh / reset) ─────────
export const newOpaqueToken = () => randomBytes(32).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
export const newFamilyId = () => randomUUID();

// ───────── access JWT ─────────
export interface AccessClaims {
  sub: string; // user id
  role: Role;
  cid?: string; // customer id – present for CUSTOMER role, used to scope every query
}

export const signAccessToken = (claims: AccessClaims) =>
  jwt.sign(claims, env.JWT_ACCESS_SECRET, { algorithm: "HS256", expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"] });

export const verifyAccessToken = (token: string): AccessClaims =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] }) as AccessClaims;
