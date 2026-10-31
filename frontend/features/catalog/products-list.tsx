"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState, Pagination, SearchInput, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Badge, Button, Card, PageHeader, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { useUrlParams } from "@/lib/hooks";
import { useProducts } from "./api";
import { ProductFormModal } from "./product-form";

const DEFAULTS = { search: "", type: "", isActive: "", page: "1" };

export function ProductsList() {
  const router = useRouter();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [q, setQ] = useUrlParams(DEFAULTS);
  const [creating, setCreating] = useState(false);
  const query = useProducts({ page: Number(q.page), search: q.search, type: q.type, isActive: q.isActive });
  const data = query.data;
  const filtered = !!(q.search || q.type || q.isActive);

  return (
    <>
      <PageHeader
        title="Products"
        description="What you sell. Variants and taxes are managed on each product."
        actions={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New product
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput value={q.search} onChange={(search) => setQ({ search })} placeholder="Search products" label="Search products" />
        <Select aria-label="Type" value={q.type} onChange={(e) => setQ({ type: e.target.value })} className="w-40">
          <option value="">All types</option>
          <option value="SERVICE">Services</option>
          <option value="GOODS">Goods</option>
        </Select>
        <Select aria-label="Status" value={q.isActive} onChange={(e) => setQ({ isActive: e.target.value })} className="w-40">
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <LoadingState label="Loading products" />
        ) : query.isError ? (
          <ErrorState message="Could not load products." onRetry={() => void query.refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={filtered ? "No products match your filters" : "No products yet"}
            hint={filtered ? "Try a different search." : "Add the products and services you bill for."}
            action={!filtered && isAdmin && <Button size="sm" onClick={() => setCreating(true)}>New product</Button>}
          />
        ) : (
          <TableWrap dimmed={query.isPlaceholderData}>
            <table className="w-full text-sm">
              <THead>
                <tr>
                  <th className={thClass}>Product</th>
                  <th className={thClass}>Type</th>
                  <th className={`${thClass} text-right`}>Sales price</th>
                  <th className={thClass}>Tax</th>
                  <th className={thClass}>Variants</th>
                  <th className={thClass}>Status</th>
                </tr>
              </THead>
              <tbody className="divide-y divide-border">
                {data?.items.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => router.push(`/products/${p.id}`)}>
                    <td className={tdClass}>
                      <Link href={`/products/${p.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                    </td>
                    <td className={tdClass}>{p.type === "SERVICE" ? "Service" : "Goods"}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(p.salesPrice)}</td>
                    <td className={`${tdClass} text-muted`}>{p.tax ? `${p.tax.name}` : "None"}</td>
                    <td className={`${tdClass} tabular-nums`}>{p.variants.length}</td>
                    <td className={tdClass}>{p.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="products" onPage={(p) => setQ({ page: String(p) }, { resetPage: false })} />}
      </Card>

      <ProductFormModal open={creating} onClose={() => setCreating(false)} onSaved={(p) => router.push(`/products/${p.id}`)} />
    </>
  );
}
