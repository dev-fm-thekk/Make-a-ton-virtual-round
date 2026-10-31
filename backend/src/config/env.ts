import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),

  APP_BASE_URL: z.string().url().default("http://localhost:3000"),

  // Billing engine. Run the scheduler on ONE instance (or all: a DB guard makes extra runs no-ops).
  BILLING_SCHEDULER: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** UTC hour after which the daily run starts (0-23). */
  BILLING_RUN_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(1),
  /** Invoices built in parallel by one run. Keep below DB pool size (see lib/prisma.ts). */
  BILLING_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  /** Scheduled runs confirm (number) invoices immediately instead of leaving drafts for review. */
  BILLING_AUTO_CONFIRM: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),

  // Email (nodemailer). Without SMTP_HOST, mail is logged instead of sent (dev only).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Brightloop Billing <no-reply@brightloop.local>"),
}).refine((e) => e.NODE_ENV !== "production" || !!e.SMTP_HOST, {
  message: "SMTP_HOST is required in production",
  path: ["SMTP_HOST"],
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast at boot: a misconfigured service must never start serving traffic.
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
