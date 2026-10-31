// The daily scheduler's configuration lives in one database row (billing_settings), edited by admins in the Billing
// page. Every API instance reads it on each tick, so a change takes effect within minutes with no restart or env edit.

import { todayUtc, toDateOnly } from "../../lib/dates.js";
import { prisma } from "../../lib/prisma.js";
import { SCHEDULER_CHECK_MINUTES, scheduleStatus, type SchedulerSettings } from "./schedule.js";

export { SCHEDULER_CHECK_MINUTES, type SchedulerSettings };

export async function getSettings() {
  const row = await prisma.billingSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  return row;
}

export async function updateSettings(patch: Partial<SchedulerSettings>, userId: string) {
  return prisma.billingSettings.upsert({ where: { id: 1 }, update: { ...patch, updatedById: userId }, create: { id: 1, ...patch, updatedById: userId } });
}

/** Settings plus what the page needs to explain them: the next run and how the last scheduled run went. */
export async function describeSettings(now = new Date()) {
  const s = await getSettings();
  const today = todayUtc(now);
  const [last, ranToday, updater] = await Promise.all([
    prisma.billingRun.findFirst({ where: { triggeredBy: "scheduler" }, orderBy: { startedAt: "desc" }, select: { id: true, runDate: true, status: true, startedAt: true, finishedAt: true, invoiced: true, failed: true } }),
    prisma.billingRun.count({ where: { triggeredBy: "scheduler", runDate: today } }),
    s.updatedById ? prisma.user.findUnique({ where: { id: s.updatedById }, select: { name: true } }) : null,
  ]);
  const status = scheduleStatus(s, now, ranToday > 0);
  return {
    schedulerEnabled: s.schedulerEnabled,
    runHourUtc: s.runHourUtc,
    autoConfirm: s.autoConfirm,
    state: status.state,
    nextRunAt: status.nextRunAt,
    checkEveryMinutes: SCHEDULER_CHECK_MINUTES,
    lastScheduledRun: last && { id: last.id, runDate: toDateOnly(last.runDate), status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, invoiced: last.invoiced, failed: last.failed },
    updatedAt: s.updatedAt,
    updatedBy: updater?.name ?? null,
  };
}
