import { describe, expect, it } from "vitest";
import { scheduleStatus } from "./schedule.js";

const on = { schedulerEnabled: true, runHourUtc: 1, autoConfirm: false };
const at = (iso: string) => new Date(iso);

describe("scheduleStatus", () => {
  it("is off when disabled, whatever the time", () => {
    expect(scheduleStatus({ ...on, schedulerEnabled: false }, at("2026-10-31T05:00:00Z"), false)).toEqual({ state: "off", nextRunAt: null });
  });
  it("waits for the run hour today", () => {
    expect(scheduleStatus(on, at("2026-10-31T00:30:00Z"), false)).toEqual({ state: "waiting", nextRunAt: at("2026-10-31T01:00:00Z") });
  });
  it("is due once the hour has passed and nothing ran today", () => {
    const now = at("2026-10-31T09:10:00Z");
    expect(scheduleStatus(on, now, false)).toEqual({ state: "due", nextRunAt: now });
  });
  it("points at tomorrow once today's run was claimed", () => {
    expect(scheduleStatus({ ...on, runHourUtc: 23 }, at("2026-10-31T23:30:00Z"), true)).toEqual({ state: "done", nextRunAt: at("2026-11-01T23:00:00Z") });
  });
  it("handles midnight", () => {
    expect(scheduleStatus({ ...on, runHourUtc: 0 }, at("2026-10-31T00:00:00Z"), false).state).toBe("due");
  });
});
