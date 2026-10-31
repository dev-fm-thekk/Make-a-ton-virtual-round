// In-process daily scheduler. Several API instances may all run it: the database decides who bills today
// (unique index on billing_runs for scheduler runs), the others simply stand down.
// On/off, run hour and auto-confirm come from billing_settings (see settings.service.ts), not the environment.

import { logger } from "../../lib/logger.js";
import { todayUtc } from "../../lib/dates.js";
import { closeExpiredSubscriptions } from "../subscriptions/subscriptions.service.js";
import { createRun, runInBackground } from "./billing.service.js";
import { getSettings, SCHEDULER_CHECK_MINUTES } from "./settings.service.js";

const TICK_MS = SCHEDULER_CHECK_MINUTES * 60_000;

export async function runScheduledBillingOnce(now = new Date()): Promise<"ran" | "disabled" | "not-yet" | "already-ran"> {
  // Read on every tick: admins switch the scheduler on/off and move the hour from the Billing page.
  const settings = await getSettings();
  if (!settings.schedulerEnabled) return "disabled";
  if (now.getUTCHours() < settings.runHourUtc) return "not-yet";

  const run = await createRun({ triggeredBy: "scheduler", asOf: todayUtc(now) });
  if (!run) return "already-ran"; // another instance (or an earlier tick) already claimed today

  try {
    // Housekeeping first: close subscriptions whose plan auto-closes when it ends, so they aren't billed on.
    const closed = await closeExpiredSubscriptions(run.runDate);
    if (closed) logger.info({ closed }, "auto-closed expired subscriptions");
  } catch (err) {
    logger.error({ err }, "auto-close failed (continuing with billing)");
  }
  const summary = await runInBackground(run, { triggeredBy: "scheduler", asOf: run.runDate, autoConfirm: settings.autoConfirm });
  logger.info({ runId: run.id, ...summary }, "scheduled billing run finished");
  return "ran";
}

/** Starts the ticking timer on every instance; whether anything happens is decided by the settings row. Returns a stop function for graceful shutdown. */
export function startBillingScheduler(): () => void {
  const tick = () => {
    runScheduledBillingOnce().catch((err) => logger.error({ err }, "billing scheduler tick failed"));
  };
  const timer = setInterval(tick, TICK_MS);
  timer.unref(); // never keep the process alive just for this
  setTimeout(tick, 15_000).unref(); // first check shortly after boot
  logger.info({ everyMinutes: SCHEDULER_CHECK_MINUTES }, "billing scheduler ticking (enable it in Billing settings)");
  return () => clearInterval(timer);
}
