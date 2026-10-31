// Single HTTP client for the whole app.
//  * access token lives in memory only (never localStorage → not readable by XSS-injected scripts' persistence)
//  * refresh token is an httpOnly cookie managed by the API
//  * a 401 triggers exactly one silent refresh + retry; concurrent refreshes are de-duplicated
//    (in-tab via a shared promise, across tabs via the Web Locks API) so token rotation never trips reuse-detection.

import type { SessionResponse } from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  /** zod `flatten()` field errors from VALIDATION_ERROR responses. */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: Record<string, string[]> } | undefined;
    return d?.fieldErrors ?? {};
  }
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

type Listener = () => void;
const expiredListeners = new Set<Listener>();
export const onSessionExpired = (fn: Listener) => {
  expiredListeners.add(fn);
  return () => void expiredListeners.delete(fn);
};

async function raw(path: string, init: RequestInit & { auth?: boolean }): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (init.auth !== false && accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  return fetch(BASE + path, { ...init, headers, credentials: "same-origin" });
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? "UNKNOWN", e?.message ?? res.statusText, e?.details);
  }
  return json as T;
}

// ───────── refresh (single-flight) ─────────
let inflight: Promise<SessionResponse | null> | null = null;

async function doRefresh(): Promise<SessionResponse | null> {
  const res = await raw("/auth/refresh", { method: "POST", body: "{}", auth: false });
  if (!res.ok) return null;
  const session = await parse<SessionResponse>(res);
  accessToken = session.accessToken;
  return session;
}

export function refreshSession(): Promise<SessionResponse | null> {
  inflight ??= (async () => {
    try {
      // Cross-tab mutex: the second tab waits, then refreshes with the cookie the first tab just rotated.
      if (typeof navigator !== "undefined" && "locks" in navigator) {
        return await navigator.locks.request("brightloop-auth-refresh", doRefresh);
      }
      return await doRefresh();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// ───────── public request helpers ─────────
interface Opts {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean;
  /** Extra request headers (e.g. Idempotency-Key). */
  headers?: Record<string, string>;
}

export async function api<T = unknown>(method: string, path: string, opts: Opts = {}): Promise<T> {
  const qs = opts.query
    ? "?" +
      new URLSearchParams(
        Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  const init = { method, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), auth: opts.auth, headers: opts.headers };

  let res = await raw(path + (qs === "?" ? "" : qs), init);
  if (res.status === 401 && opts.auth !== false) {
    const session = await refreshSession();
    if (!session) {
      accessToken = null;
      expiredListeners.forEach((fn) => fn());
      return parse<T>(res);
    }
    res = await raw(path + (qs === "?" ? "" : qs), init);
  }
  return parse<T>(res);
}

export const get = <T>(path: string, query?: Opts["query"]) => api<T>("GET", path, { query });
export const post = <T>(path: string, body?: unknown, auth?: boolean) => api<T>("POST", path, { body, auth });
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, { body });
export const del = <T>(path: string) => api<T>("DELETE", path);

/** GET a non-JSON body (e.g. the printable invoice HTML) with the same auth and silent token refresh as api(). */
export async function fetchText(path: string): Promise<string> {
  let res = await raw(path, { method: "GET" });
  if (res.status === 401) {
    const session = await refreshSession();
    if (!session) {
      accessToken = null;
      expiredListeners.forEach((fn) => fn());
    } else {
      res = await raw(path, { method: "GET" });
    }
  }
  if (!res.ok) throw new ApiError(res.status, "UNKNOWN", res.statusText);
  return res.text();
}
