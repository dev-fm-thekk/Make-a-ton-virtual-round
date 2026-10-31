"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/data/list-parts";
import { Alert, Badge, Button, Card, CheckboxField, Modal, SelectField } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { errorMessage } from "@/lib/forms";
import { useSchedulerSettings, useUpdateSchedulerSettings, type SchedulerSettings } from "./api";

/** "01:00 UTC" with the viewer's own time next to it, so nobody has to convert. */
function hourLabel(h: number): string {
  const local = new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${String(h).padStart(2, "0")}:00 UTC (${local} your time)`;
}

function nextRunText(s: SchedulerSettings): string {
  if (!s.nextRunAt) return "Off. Nothing is billed automatically.";
  switch (s.state) {
    case "due":
      return `Starts at the next check (within ${s.checkEveryMinutes} minutes).`;
    case "waiting":
      return `Next run: ${formatDateTime(s.nextRunAt)}.`;
    default:
      return `Today's run (UTC) is done. Next run: ${formatDateTime(s.nextRunAt)}.`;
  }
}

const RUN_TONE = { RUNNING: "primary", COMPLETED: "success", PARTIAL: "warning", FAILED: "danger" } as const;
const RUN_LABEL = { RUNNING: "Running", COMPLETED: "Completed", PARTIAL: "Needs attention", FAILED: "Failed" } as const;

export function SchedulerCard({ isAdmin }: { isAdmin: boolean }) {
  const query = useSchedulerSettings();
  const [editing, setEditing] = useState(false);
  const s = query.data;

  return (
    <Card className="mb-6 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Daily scheduler</h2>
          {s && <Badge tone={s.schedulerEnabled ? "success" : "neutral"}>{s.schedulerEnabled ? "On" : "Off"}</Badge>}
        </div>
        {isAdmin && s && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Settings2 className="size-4" aria-hidden /> Configure
          </Button>
        )}
      </div>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError || !s ? (
        <ErrorState message="Could not load the scheduler settings." onRetry={() => void query.refetch()} />
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">{nextRunText(s)}</p>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Runs daily after</dt>
              <dd className="mt-1 font-medium">{hourLabel(s.runHourUtc)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Invoices are</dt>
              <dd className="mt-1 font-medium">{s.autoConfirm ? "Confirmed and numbered" : "Left as drafts for review"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Last scheduled run</dt>
              <dd className="mt-1 font-medium">
                {s.lastScheduledRun ? (
                  <>
                    {formatDate(s.lastScheduledRun.runDate)} <Badge tone={RUN_TONE[s.lastScheduledRun.status]}>{RUN_LABEL[s.lastScheduledRun.status]}</Badge>
                    <span className="block text-xs font-normal text-muted">
                      {s.lastScheduledRun.invoiced} invoiced{s.lastScheduledRun.failed > 0 && `, ${s.lastScheduledRun.failed} failed`}
                    </span>
                  </>
                ) : (
                  "Never"
                )}
              </dd>
            </div>
          </dl>
          {s.updatedBy && (
            <p className="mt-4 text-xs text-muted">
              Last changed by {s.updatedBy}, {formatDateTime(s.updatedAt)}.
            </p>
          )}
          <Modal open={editing} onClose={() => setEditing(false)} title="Daily scheduler">
            <SchedulerForm settings={s} onClose={() => setEditing(false)} />
          </Modal>
        </>
      )}
    </Card>
  );
}

function SchedulerForm({ settings, onClose }: { settings: SchedulerSettings; onClose: () => void }) {
  const update = useUpdateSchedulerSettings();
  const [enabled, setEnabled] = useState(settings.schedulerEnabled);
  const [hour, setHour] = useState(String(settings.runHourUtc));
  const [autoConfirm, setAutoConfirm] = useState(settings.autoConfirm);
  const [error, setError] = useState<string | null>(null);
  const dirty = enabled !== settings.schedulerEnabled || Number(hour) !== settings.runHourUtc || autoConfirm !== settings.autoConfirm;
  // Switching on (or moving the hour earlier) after the hour has passed today starts a run at the next check.
  const startsSoon = enabled && Number(hour) <= new Date().getUTCHours() && settings.state !== "done";

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ schedulerEnabled: enabled, runHourUtc: Number(hour), autoConfirm });
      toast.success(enabled ? "Scheduler saved" : "Scheduler turned off");
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <CheckboxField label="Run billing automatically every day" hint="Bills every active subscription that is due, once a day." checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <SelectField label="Start after" value={hour} onChange={(e) => setHour(e.target.value)} disabled={!enabled} hint="Checked every few minutes, so it starts shortly after this hour.">
        {Array.from({ length: 24 }, (_, h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </SelectField>
      <CheckboxField
        label="Confirm invoices immediately"
        hint="Off: scheduled runs create drafts for staff to review. On: invoices are numbered and sent to customers without review."
        checked={autoConfirm}
        disabled={!enabled}
        onChange={(e) => setAutoConfirm(e.target.checked)}
      />
      {startsSoon && dirty && <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">That time has already passed today, so a run starts within {settings.checkEveryMinutes} minutes of saving.</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={update.isPending} disabled={!dirty}>
          Save
        </Button>
      </div>
    </div>
  );
}
