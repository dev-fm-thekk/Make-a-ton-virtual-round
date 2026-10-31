"use client";

// Building blocks shared by every list screen: search box, pagination, and the loading/empty/error states.

import { ChevronLeft, ChevronRight, Inbox, Search, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useDebounced } from "@/lib/hooks";
import { formatCount } from "@/lib/format";
import { Button, Spinner } from "../ui";

export function SearchInput({ value, onChange, placeholder = "Search", label = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  // Typing is instant locally; the (URL/query) value updates after a short pause.
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  // If the URL value changes from outside (back button, "clear filters"), adopt it. Done during render, not in an effect.
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  const debounced = useDebounced(text);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // only react to the debounced text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="relative min-w-56 flex-1">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm focus:border-ring"
      />
    </div>
  );
}

export function Pagination({ page, totalPages, total, noun, onPage }: { page: number; totalPages: number; total: number; noun: string; onPage: (p: number) => void }) {
  if (totalPages <= 1) return total > 0 ? <p className="border-t border-border px-4 py-3 text-sm text-muted">{formatCount(total)} {noun}</p> : null;
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
      <span className="text-muted">
        Page {formatCount(page)} of {formatCount(totalPages)} · {formatCount(total)} {noun}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted" role="status">
      <Spinner /> {label}…
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Inbox className="size-8 text-muted" aria-hidden />
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong loading this.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
      <TriangleAlert className="size-8 text-danger" aria-hidden />
      <p className="text-sm">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Wraps a table so wide content scrolls sideways on phones instead of breaking the page. */
export function TableWrap({ children, dimmed }: { children: ReactNode; dimmed?: boolean }) {
  return <div className={`overflow-x-auto transition-opacity ${dimmed ? "opacity-60" : ""}`}>{children}</div>;
}

export const thClass = "px-4 py-3 text-left font-medium";
export const tdClass = "px-4 py-3";
export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-muted">{children}</thead>;
}
