"use client";

import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/data/dialogs";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui";
import { billingCycle } from "@/features/subscriptions/labels";
import { useAuth } from "@/lib/auth";
import { formatMoney, plural } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useTemplateMutations, useTemplates, type Template } from "./api";

const DEFAULTS = { search: "", isActive: "", page: "1" };

export function TemplatesList() {
  const router = useRouter();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [q, setQ] = useUrlParams(DEFAULTS);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const { remove } = useTemplateMutations();
  const query = useTemplates({ page: Number(q.page), search: q.search, isActive: q.isActive });
  const data = query.data;
  const filtered = !!(q.search || q.isActive);

  return (
    <>
      <PageHeader
        title="Quotation templates"
        description="Ready-made quotations: a plan plus a set of products to start new subscriptions from."
        actions={
          isAdmin && (
            <Button onClick={() => router.push("/quotation-templates/new")}>
              <Plus className="size-4" aria-hidden /> New template
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder="Search templates" label="Search templates" />
        <Select aria-label="Status" value={q.isActive} onChange={(e) => setQ({ isActive: e.target.value })} className="w-40">
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading templates" />
        ) : query.isError ? (
          <ErrorState message="Could not load templates." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "No templates match your filters" : "No templates yet"}
            hint={filtered ? "Try a different search." : "Templates make creating a subscription a one-click start."}
            action={!filtered && isAdmin && <Button size="sm" onClick={() => router.push("/quotation-templates/new")}>New template</Button>}
          />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Template</th>
                  <th className={thClass}>Plan</th>
                  <th className={thClass}>Lines</th>
                  <th className={`${thClass} text-right`}>Estimated per period</th>
                  <th className={thClass}>Status</th>
                  {isAdmin && (
                    <th className={`${thClass} w-16`}>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => router.push(`/quotation-templates/${t.id}`)}>
                    <td className={tdClass}>
                      <Link href={`/quotation-templates/${t.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {t.name}
                      </Link>
                      <p className="text-xs text-muted">Valid for {plural(t.validityDays, "day")}</p>
                    </td>
                    <td className={tdClass}>
                      {t.plan.name}
                      <p className="text-xs text-muted">{billingCycle(t.plan)}</p>
                    </td>
                    <td className={`${tdClass} tabular-nums`}>{t.lines.length}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(t.estimatedUntaxed)}</td>
                    <td className={tdClass}>
                      {!t.isActive ? (
                        <Badge>Inactive</Badge>
                      ) : t.usable ? (
                        <Badge tone="success">Ready</Badge>
                      ) : (
                        <span title={t.problems.join("\n")}>
                          <Badge tone="warning">
                            <AlertTriangle className="mr-1 size-3" aria-hidden /> Needs attention
                          </Badge>
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className={tdClass}>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${t.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleting(t);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="templates" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>

      <ConfirmDialog
        open={!!deleting}
        title="Delete template"
        danger
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          toast.success("Template deleted");
        }}
      >
        Delete <strong>{deleting?.name}</strong>? Subscriptions already created from it are not affected.
      </ConfirmDialog>
    </>
  );
}
