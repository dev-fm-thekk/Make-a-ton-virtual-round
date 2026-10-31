"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Filter/pagination state that lives in the URL (?status=ACTIVE&page=2), so a refresh, the back button
 * and a pasted link all restore the same view. Values equal to their default are omitted from the URL.
 * The component using this must sit under a <Suspense> boundary (it reads search params).
 */
export function useUrlParams<T extends Record<string, string>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const values = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const v = search.get(key);
      if (v !== null) (out as Record<string, string>)[key] = v;
    }
    return out;
    // `defaults` is a module-level constant at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const set = useCallback(
    (patch: Partial<T>, opts: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || v === defaults[k]) next.delete(k);
        else next.set(k, String(v));
      }
      if (opts.resetPage && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, pathname, router],
  );

  return [values, set] as const;
}
