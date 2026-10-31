"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { ApiError } from "@/lib/api";

let browserClient: QueryClient | undefined;

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Don't hammer the API on 4xx; retry transient failures once.
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
      },
    },
  });
}

const getClient = () => (typeof window === "undefined" ? makeClient() : (browserClient ??= makeClient()));

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getClient()}>
      <AuthProvider>{children}</AuthProvider>
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
