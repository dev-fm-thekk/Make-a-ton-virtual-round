// Pure scheduling rules (no database), so they are unit-testable.

export const SCHEDULER_CHECK_MINUTES = 5;

export interface SchedulerSettings {
  schedulerEnabled: boolean;
  runHourUtc: number;
  autoConfirm: boolean;
}

export type ScheduleState = "off" | "waiting" | "due" | "done";

/**
 * Where today stands. "waiting": before the run hour. "due": the hour has passed and nothing ran yet, so the next
 * check (within SCHEDULER_CHECK_MINUTES) starts the run. "done": today's run was already claimed; next is tomorrow.
 */
export function scheduleStatus(s: SchedulerSettings, now: Date, ranToday: boolean): { state: ScheduleState; nextRunAt: Date | null } {
  if (!s.schedulerEnabled) return { state: "off", nextRunAt: null };
  const todayAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.runHourUtc));
  if (ranToday) return { state: "done", nextRunAt: new Date(todayAt.getTime() + 24 * 3_600_000) };
  if (now.getTime() >= todayAt.getTime()) return { state: "due", nextRunAt: now };
  return { state: "waiting", nextRunAt: todayAt };
}
