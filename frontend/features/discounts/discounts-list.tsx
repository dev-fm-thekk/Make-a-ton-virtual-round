"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Button, Card, PageHeader, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useDiscounts } from "./api";
import { DiscountFormModal } from "./discount-form";
import { DiscountStatusBadge, formatDiscountValue, SCOPE_LABEL, STATUS_OPTIONS, usageText } from "./labels";

const DEFAULTS = { search: "", status: "", scope: "", page: "1" };

export function DiscountsList() {
  const router = useRouter();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [q, setQ] = useUrlParams(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const query = useDiscounts({ page: Number(q.page), search: q.search, status: q.status, scope: q.scope });
  const data = query.data;
  const filtered = !!(q.search || q.status || q.scope);

  return (
    <>
      <PageHeader
        title="Discounts"
        description="Percentage or fixed reductions, by product or for a whole subscription."
        actions={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New discount
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder="Search discounts" label="Search discounts" />
        <Select aria-label="Status" value={q.status} onChange={(e) => setQ({ status: e.target.value })} className="w-44">
          <option value="">Any status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Applies to" value={q.scope} onChange={(e) => setQ({ scope: e.target.value })} className="w-48">
          <option value="">Any scope</option>
          <option value="PRODUCT">Specific products</option>
          <option value="SUBSCRIPTION">Whole subscription</option>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading discounts" />
        ) : query.isError ? (
          <ErrorState message="Could not load discounts." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "No discounts match your filters" : "No discounts yet"}
            hint={filtered ? "Try a different search." : "Create a discount to apply it automatically on invoices."}
            action={!filtered && isAdmin && <Button size="sm" onClick={() => setCreating(true)}>New discount</Button>}
          />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Discount</th>
                  <th className={thClass}>Value</th>
                  <th className={thClass}>Applies to</th>
                  <th className={thClass}>Valid</th>
                  <th className={thClass}>Usage</th>
                  <th className={thClass}>Status</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => router.push(`/discounts/${d.id}`)}>
                    <td className={tdClass}>
                      <Link href={`/discounts/${d.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {d.name}
                      </Link>
                    </td>
                    <td className={`${tdClass} tabular-nums`}>{formatDiscountValue(d)}</td>
                    <td className={tdClass}>
                      {SCOPE_LABEL[d.scope]}
                      <p className="text-xs text-muted">{d.scope === "PRODUCT" ? `${d.products.length} product${d.products.length === 1 ? "" : "s"}` : `${d.attachedSubscriptions} subscription${d.attachedSubscriptions === 1 ? "" : "s"}`}</p>
                    </td>
                    <td className={`${tdClass} text-muted`}>{d.endDate ? `${formatDate(d.startDate)} – ${formatDate(d.endDate)}` : `From ${formatDate(d.startDate)}`}</td>
                    <td className={`${tdClass} text-muted`}>{usageText(d)}</td>
                    <td className={tdClass}>
                      <DiscountStatusBadge status={d.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="discounts" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>

      <DiscountFormModal open={creating} onClose={() => setCreating(false)} onSaved={(d) => router.push(`/discounts/${d.id}`)} />
    </>
  );
}
