"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { Spinner } from "../ui";

/** Wraps login/register/etc: already-signed-in users are sent to the dashboard. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  if (status !== "anonymous") {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  return <>{children}</>;
}
