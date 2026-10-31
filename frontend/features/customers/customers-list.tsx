"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useCustomers } from "./api";
import { CustomerFormModal } from "./customer-form";

const DEFAULTS = { search: "", hasPortalAccess: "", sort: "-createdAt", page: "1" };

export function CustomersList() {
  const router = useRouter();
  const [q, setQ] = useUrlParams(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const query = useCustomers({ page: Number(q.page), search: q.search, hasPortalAccess: q.hasPortalAccess, sort: q.sort });
  const data = query.data;
  const filtered = !!(q.search || q.hasPortalAccess);

  return (
    <>
      <PageHeader
        title="Customers"
        description="The people and companies you bill."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New customer
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder="Search name, company or email" label="Search customers" />
        <Select aria-label="Portal access" value={q.hasPortalAccess} onChange={(e) => setQ({ hasPortalAccess: e.target.value })} className="w-48">
          <option value="">All customers</option>
          <option value="true">Has portal login</option>
          <option value="false">No portal login</option>
        </Select>
        <Select aria-label="Sort" value={q.sort} onChange={(e) => setQ({ sort: e.target.value })} className="w-44">
          <option value="-createdAt">Newest first</option>
          <option value="createdAt">Oldest first</option>
          <option value="name">Name A–Z</option>
          <option value="-name">Name Z–A</option>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading customers" />
        ) : query.isError ? (
          <ErrorState message="Could not load customers." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "No customers match your filters" : "No customers yet"}
            hint={filtered ? "Try a different search." : "Add a customer, or they can sign up themselves from the sign-in page."}
            action={!filtered && <Button size="sm" onClick={() => setCreating(true)}>New customer</Button>}
          />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Contact</th>
                  <th className={thClass}>Active subscriptions</th>
                  <th className={thClass}>Portal</th>
                  <th className={thClass}>Added</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => router.push(`/customers/${c.id}`)}>
                    <td className={tdClass}>
                      <Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {c.name}
                      </Link>
                      {c.companyName && <p className="text-xs text-muted">{c.companyName}</p>}
                    </td>
                    <td className={tdClass}>
                      {c.email}
                      {c.phone && <p className="text-xs text-muted">{c.phone}</p>}
                    </td>
                    <td className={`${tdClass} tabular-nums`}>{c.activeSubscriptions}</td>
                    <td className={tdClass}>{c.hasPortalAccess ? <Badge tone="success">Has login</Badge> : <Badge>No login</Badge>}</td>
                    <td className={`${tdClass} text-muted`}>{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="customers" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>

      <CustomerFormModal open={creating} onClose={() => setCreating(false)} onSaved={(c) => router.push(`/customers/${c.id}`)} />
    </>
  );
}
