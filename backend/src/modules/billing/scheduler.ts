// In-process daily scheduler. Several API instances may all run it: the database decides who bills today
// (unique index on billing_runs for scheduler runs), the others simply stand down.

import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { todayUtc } from "../../lib/dates.js";
import { closeExpiredSubscriptions } from "../subscriptions/subscriptions.service.js";
import { createRun, runInBackground } from "./billing.service.js";

const TICK_MS = 5 * 60_000;

export async function runScheduledBillingOnce(now = new Date()): Promise<"ran" | "not-yet" | "already-ran"> {
  if (now.getUTCHours() < env.BILLING_RUN_HOUR_UTC) return "not-yet";

  const run = await createRun({ triggeredBy: "scheduler", asOf: todayUtc(now) });
  if (!run) return "already-ran"; // another instance (or an earlier tick) already claimed today

  try {
    // Housekeeping first: close subscriptions whose plan auto-closes when it ends, so they aren't billed on.
    const closed = await closeExpiredSubscriptions(run.runDate);
    if (closed) logger.info({ closed }, "auto-closed expired subscriptions");
  } catch (err) {
    logger.error({ err }, "auto-close failed (continuing with billing)");
  }
  const summary = await runInBackground(run, { triggeredBy: "scheduler", asOf: run.runDate, autoConfirm: env.BILLING_AUTO_CONFIRM });
  logger.info({ runId: run.id, ...summary }, "scheduled billing run finished");
  return "ran";
}

/** Starts the ticking timer. Returns a stop function for graceful shutdown. */
export function startBillingScheduler(): () => void {
  const tick = () => {
    runScheduledBillingOnce().catch((err) => logger.error({ err }, "billing scheduler tick failed"));
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref(); // never keep the process alive just for this
  setTimeout(tick, 15_000).unref(); // first check shortly after boot
  logger.info({ hourUtc: env.BILLING_RUN_HOUR_UTC, autoConfirm: env.BILLING_AUTO_CONFIRM }, "billing scheduler started");
  return () => clearInterval(timer);
}
