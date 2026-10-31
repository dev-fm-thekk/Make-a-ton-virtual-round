"use client";

import clsx from "clsx";
import { Search, X } from "lucide-react";
import { useId, useState } from "react";
import { Field } from "@/components/ui";
import { useDebounced } from "@/lib/hooks";
import { useCustomerSearch } from "./api";

export interface PickedCustomer {
  id: string;
  name: string;
  companyName?: string | null;
}

/** Type-ahead customer selector (accessible combobox). Searches the API; never loads the whole customer list. */
export function CustomerPicker({ value, onChange, error }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; error?: string }) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useDebounced(text.trim());
  const { data, isFetching } = useCustomerSearch(search);
  const results = data?.items ?? [];

  const choose = (c: PickedCustomer) => {
    onChange({ id: c.id, name: c.name, companyName: c.companyName });
    setText("");
    setOpen(false);
  };

  if (value) {
    return (
      <Field label="Customer" htmlFor={id} error={error}>
        <div id={id} className="flex h-10 items-center justify-between rounded-lg border border-border bg-surface px-3 text-sm">
          <span className="truncate">
            {value.name}
            {value.companyName && <span className="text-muted"> · {value.companyName}</span>}
          </span>
          <button type="button" onClick={() => onChange(null)} aria-label="Change customer" className="ml-2 rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Customer" htmlFor={id} error={error} hint="Search by name, company or email.">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={!!error}
          autoComplete="off"
          value={text}
          placeholder="Start typing a customer…"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)} // let a click on an option land first
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && results[active]) {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
          className={clsx("h-10 w-full rounded-lg border bg-surface pl-9 pr-3 text-sm focus:border-ring", error ? "border-danger" : "border-border")}
        />
        {open && (
          <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">{isFetching ? "Searching…" : search ? "No customers found" : "No customers yet"}</li>
            ) : (
              results.map((c, i) => (
                <li
                  key={c.id}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(c)}
                  onMouseEnter={() => setActive(i)}
                  className={clsx("cursor-pointer px-3 py-2 text-sm", i === active && "bg-surface-2")}
                >
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted">{[c.companyName, c.email].filter(Boolean).join(" · ")}</p>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Field>
  );
}
