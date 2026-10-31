"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/data/dialogs";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui";
import { billingCycle } from "@/features/subscriptions/labels";
import { useAuth } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { usePlanMutations, usePlans, type Plan } from "./api";
import { PlanFormModal } from "./plan-form";

const DEFAULTS = { search: "", billingPeriod: "", isActive: "", page: "1" };

function availability(p: Plan): string {
  return p.availableUntil ? `${formatDate(p.availableFrom)} – ${formatDate(p.availableUntil)}` : `From ${formatDate(p.availableFrom)}`;
}

export function PlansList() {
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [q, setQ] = useUrlParams(DEFAULTS);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const { remove } = usePlanMutations();
  const query = usePlans({ page: Number(q.page), search: q.search, billingPeriod: q.billingPeriod, isActive: q.isActive });
  const data = query.data;
  const filtered = !!(q.search || q.billingPeriod || q.isActive);

  return (
    <>
      <PageHeader
        title="Plans"
        description="Recurring billing cycles, prices and subscription rules."
        actions={
          isAdmin && (
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> New plan
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder="Search plans" label="Search plans" />
        <Select aria-label="Billing period" value={q.billingPeriod} onChange={(e) => setQ({ billingPeriod: e.target.value })} className="w-40">
          <option value="">Any period</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </Select>
        <Select aria-label="Status" value={q.isActive} onChange={(e) => setQ({ isActive: e.target.value })} className="w-40">
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading plans" />
        ) : query.isError ? (
          <ErrorState message="Could not load plans." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "No plans match your filters" : "No plans yet"}
            hint={filtered ? "Try a different search." : "A plan sets how often and how much a subscription bills."}
            action={!filtered && isAdmin && <Button size="sm" onClick={() => setEditing("new")}>New plan</Button>}
          />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Plan</th>
                  <th className={`${thClass} text-right`}>Price</th>
                  <th className={thClass}>Billing</th>
                  <th className={thClass}>Available</th>
                  <th className={thClass}>Live subscriptions</th>
                  <th className={thClass}>Status</th>
                  {isAdmin && (
                    <th className={`${thClass} w-24`}>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((p) => (
                  <tr key={p.id}>
                    <td className={`${tdClass} font-medium`}>{p.name}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(p.price)}</td>
                    <td className={tdClass}>{billingCycle(p)}</td>
                    <td className={`${tdClass} text-muted`}>{availability(p)}</td>
                    <td className={`${tdClass} tabular-nums`}>{p.liveSubscriptions}</td>
                    <td className={tdClass}>{p.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                    {isAdmin && (
                      <td className={tdClass}>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="plans" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>

      <PlanFormModal open={editing !== null} onClose={() => setEditing(null)} plan={editing && editing !== "new" ? editing : undefined} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete plan"
        danger
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          toast.success("Plan deleted");
        }}
      >
        Delete <strong>{deleting?.name}</strong>? Plans used by subscriptions or quotation templates cannot be deleted; make them inactive instead.
      </ConfirmDialog>
    </>
  );
}
