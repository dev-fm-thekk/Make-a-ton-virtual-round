"use client";

import { ArrowLeft, Pencil, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/data/dialogs";
import { EmptyState, ErrorState, LoadingState, Pagination, TableWrap, tdClass, THead, thClass } from "@/components/data/list-parts";
import { Button, Card, PageHeader } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useDiscount, useDiscountMutations, useRedemptions, type Discount } from "./api";
import { DiscountFormModal } from "./discount-form";
import { DiscountStatusBadge, formatDiscountValue, SCOPE_LABEL, usageText } from "./labels";

export function DiscountDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <DiscountDetail id={id} />;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

function DiscountDetail({ id }: { id: string }) {
  const router = useRouter();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const query = useDiscount(id);
  const { remove } = useDiscountMutations();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (query.isPending) return <LoadingState label="Loading discount" />;
  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return <ErrorState message={missing ? "This discount does not exist." : "Could not load this discount."} onRetry={missing ? undefined : () => void query.refetch()} />;
  }
  const d = query.data;

  return (
    <>
      <Link href="/discounts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Discounts
      </Link>
      <PageHeader
        title={d.name}
        description={`${formatDiscountValue(d)} off · ${SCOPE_LABEL[d.scope]}`}
        actions={
          isAdmin && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
              <Button variant="secondary" onClick={() => setDeleting(true)}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            </div>
          )
        }
      />

      <Card className="mb-6 p-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <Fact label="Status">
            <DiscountStatusBadge status={d.status} />
          </Fact>
          <Fact label="Valid">{d.endDate ? `${formatDate(d.startDate)} – ${formatDate(d.endDate)}` : `From ${formatDate(d.startDate)}`}</Fact>
          <Fact label="Usage">{usageText(d)}</Fact>
          <Fact label="Remaining">{d.remainingUses === null ? "Unlimited" : d.remainingUses}</Fact>
          <Fact label="Minimum purchase">{d.minPurchaseAmount ? formatMoney(d.minPurchaseAmount) : "None"}</Fact>
          <Fact label="Minimum quantity">{d.minQuantity ?? "None"}</Fact>
          <Fact label="Invoices reduced">{d.redemptions}</Fact>
          <Fact label="Attached subscriptions">{d.scope === "SUBSCRIPTION" ? d.attachedSubscriptions : "n/a"}</Fact>
        </dl>
      </Card>

      {d.scope === "PRODUCT" && <ProductsCard discount={d} isAdmin={isAdmin} />}
      <Redemptions id={d.id} />

      <DiscountFormModal open={editing} onClose={() => setEditing(false)} discount={d} />
      <ConfirmDialog
        open={deleting}
        title="Delete discount"
        danger
        confirmLabel="Delete"
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await remove.mutateAsync(d.id);
          toast.success("Discount deleted");
          router.replace("/discounts");
        }}
      >
        Delete <strong>{d.name}</strong>? It stops applying immediately. Past redemptions stay on their invoices.
      </ConfirmDialog>
    </>
  );
}

function ProductsCard({ discount, isAdmin }: { discount: Discount; isAdmin: boolean }) {
  const { detachProduct } = useDiscountMutations();
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  return (
    <Card className="mb-6 p-5">
      <h2 className="font-semibold">Products</h2>
      {discount.products.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No products yet. Edit the discount to add some; it applies to nothing until then.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {discount.products.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
              <Link href={`/products/${p.id}`} className="hover:underline">
                {p.name}
              </Link>
              {isAdmin && (
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setRemoving(p)} className="rounded-full p-1 text-muted hover:bg-border">
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!removing}
        title="Remove product"
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          await detachProduct.mutateAsync({ id: discount.id, productId: removing!.id });
          toast.success("Product removed");
        }}
      >
        Stop applying <strong>{discount.name}</strong> to <strong>{removing?.name}</strong>? An active discount must keep at least one product.
      </ConfirmDialog>
    </Card>
  );
}

function Redemptions({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const query = useRedemptions(id, page);
  const data = query.data;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">Where it was used</h2>
      </div>
      {query.isPending ? (
        <LoadingState label="Loading redemptions" />
      ) : query.isError ? (
        <ErrorState message="Could not load redemptions." onRetry={() => void query.refetch()} />
      ) : data && data.items.length === 0 ? (
        <EmptyState title="Not used yet" hint="Each invoice this discount reduces will be listed here." />
      ) : (
        <TableWrap dimmed={query.isPlaceholderData}>
          <table className="w-full text-sm">
            <THead>
              <tr>
                <th className={thClass}>Invoice</th>
                <th className={thClass}>Customer</th>
                <th className={thClass}>Subscription</th>
                <th className={`${thClass} text-right`}>Amount off</th>
                <th className={thClass}>When</th>
              </tr>
            </THead>
            <tbody className="divide-y divide-border">
              {data?.items.map((r) => (
                <tr key={r.id}>
                  <td className={tdClass}>
                    <Link href={`/invoices/${r.invoice.id}`} className="font-medium text-primary hover:underline">
                      {r.invoice.number}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <Link href={`/customers/${r.customer.id}`} className="hover:underline">
                      {r.customer.name}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    {r.subscription ? (
                      <Link href={`/subscriptions/${r.subscription.id}`} className="hover:underline">
                        {r.subscription.number}
                      </Link>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>{formatMoney(r.amount)}</td>
                  <td className={`${tdClass} text-muted`}>{formatDateTime(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} total={data.total} noun="redemptions" onPage={setPage} />}
    </Card>
  );
}
