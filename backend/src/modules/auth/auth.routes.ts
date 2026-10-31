import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { isProd } from "../../config/env.js";
import { unauthorized } from "../../lib/errors.js";
import { auth, authenticate } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schemas.js";
import * as svc from "./auth.service.js";

export const authRouter = Router();

const REFRESH_COOKIE = "refresh_token";
const cookieOpts = (expires?: Date) => ({
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/api/v1/auth",
  expires,
});

const meta = (req: Request) => ({ userAgent: req.get("user-agent") ?? undefined, ip: req.ip });

function sendSession(res: Response, s: svc.Session, status = 200) {
  res.cookie(REFRESH_COOKIE, s.refreshToken, cookieOpts(s.refreshExpiresAt));
  // refreshToken is also returned in the body for non-browser clients (mobile, curl, tests).
  res.status(status).json({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
}

// Brute-force / abuse protection. In-memory store → per instance; swap for a Redis store when running >1 instance.
const limiter = (max: number, windowMin = 15) =>
  rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: "draft-7", legacyHeaders: false, skip: () => !isProd }); // off in dev/test so frontend work isn't throttled
const strict = limiter(10); // register / login / forgot / reset
const loose = limiter(60); // refresh / logout

authRouter.post("/register", strict, validate({ body: registerSchema }), async (req, res) => {
  sendSession(res, await svc.register(req.body, meta(req)), 201);
});

authRouter.post("/login", strict, validate({ body: loginSchema }), async (req, res) => {
  sendSession(res, await svc.login(req.body, meta(req)));
});

authRouter.post("/refresh", loose, validate({ body: refreshSchema }), async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] ?? req.body.refreshToken;
  if (!token) throw unauthorized("Missing refresh token");
  sendSession(res, await svc.refresh(token, meta(req)));
});

authRouter.post("/logout", loose, validate({ body: refreshSchema }), async (req, res) => {
  await svc.logout(req.cookies?.[REFRESH_COOKIE] ?? req.body.refreshToken);
  res.clearCookie(REFRESH_COOKIE, cookieOpts());
  res.status(204).end();
});

authRouter.post("/forgot-password", strict, validate({ body: forgotPasswordSchema }), async (req, res) => {
  await svc.forgotPassword(req.body.email);
  // Same response whether or not the account exists.
  res.json({ message: "If an account exists for that email, a reset link has been sent." });
});

authRouter.post("/reset-password", strict, validate({ body: resetPasswordSchema }), async (req, res) => {
  await svc.resetPassword(req.body.token, req.body.password);
  res.json({ message: "Password updated. Please sign in." });
});

authRouter.post("/change-password", authenticate, validate({ body: changePasswordSchema }), async (req, res) => {
  await svc.changePassword(auth(req).userId, req.body.currentPassword, req.body.newPassword);
  res.clearCookie(REFRESH_COOKIE, cookieOpts());
  res.json({ message: "Password changed. Please sign in again." });
});

authRouter.get("/me", authenticate, async (req, res) => {
  res.json({ user: await svc.me(auth(req).userId) });
});
