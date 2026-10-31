import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// SMTP when configured; otherwise a JSON transport that just returns the message so the
// dev flow (e.g. password reset) works with no mail server. Production requires SMTP_HOST (see env.ts).
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      pool: true,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export async function sendMail(msg: MailMessage): Promise<void> {
  const info = await transporter.sendMail({ from: env.MAIL_FROM, ...msg });
  if (!env.SMTP_HOST) {
    logger.info({ to: msg.to, subject: msg.subject, body: msg.text }, "[mail:dev] SMTP not configured – email not sent");
  } else {
    logger.info({ to: msg.to, messageId: info.messageId }, "mail sent");
  }
}

/** Fire-and-forget: a mail failure must never fail or slow the request that triggered it. */
export function sendMailBackground(msg: MailMessage): void {
  sendMail(msg).catch((err) => logger.error({ err, to: msg.to, subject: msg.subject }, "mail failed"));
}
