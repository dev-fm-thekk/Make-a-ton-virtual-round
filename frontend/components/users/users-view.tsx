"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, get, patch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paged, Role, UserRow } from "@/lib/types";
import { Badge, Button, Card, PageHeader, Select, Spinner } from "../ui";
import { CreateStaffModal } from "./create-staff-modal";

const ROLE_TONE = { ADMIN: "danger", STAFF: "primary", CUSTOMER: "neutral" } as const;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function UsersView() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [creating, setCreating] = useState(false);
  const search = useDebounced(searchInput);

  const isAdmin = me?.role === "ADMIN";
  const query = useQuery({
    queryKey: ["users", { page, search, role }],
    queryFn: () => get<Paged<UserRow>>("/users", { page, limit: 20, search, role }),
    placeholderData: keepPreviousData,
    enabled: isAdmin,
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => patch(`/users/${id}`, { isActive }),
    onSuccess: (_d, v) => {
      toast.success(v.isActive ? "User reactivated" : "User deactivated and signed out everywhere");
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update user"),
  });

  if (!isAdmin) {
    return (
      <Card className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <ShieldAlert className="size-8 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold">Admins only</h1>
        <p className="text-sm text-muted">You don&apos;t have access to user management.</p>
      </Card>
    );
  }

  const data = query.data;

  return (
    <>
      <PageHeader
        title="Team & users"
        description="Add staff and control who can sign in. Only admins can do this."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> Add staff
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
          <input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            placeholder="Search name or email"
            aria-label="Search users"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm focus:border-ring"
          />
        </div>
        <Select
          aria-label="Filter by role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | "");
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">All roles</option>
          <option value="ADMIN">Admin</option>
          <option value="STAFF">Staff</option>
          <option value="CUSTOMER">Customer</option>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {query.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : query.isError ? (
          <div className="p-10 text-center text-sm text-danger">
            Could not load users.{" "}
            <button className="underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        ) : data && data.items.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">No users match your filters.</p>
        ) : (
          <div className={`overflow-x-auto ${query.isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last sign-in</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data?.items.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ROLE_TONE[u.role]}>{u.role.toLowerCase()}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.isActive ? "success" : "neutral"}>{u.isActive ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{fmt(u.lastLoginAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== me?.id && (
                        <Button
                          size="sm"
                          variant={u.isActive ? "secondary" : "primary"}
                          loading={toggle.isPending && toggle.variables?.id === u.id}
                          onClick={() => {
                            if (!u.isActive || window.confirm(`Deactivate ${u.name}? They will be signed out everywhere.`)) {
                              toggle.mutate({ id: u.id, isActive: !u.isActive });
                            }
                          }}
                        >
                          {u.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted">
              Page {data.page} of {data.totalPages} · {data.total} users
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="sm" variant="secondary" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <CreateStaffModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
