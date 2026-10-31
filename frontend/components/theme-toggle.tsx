"use client";

import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribeTheme, type Theme } from "@/lib/theme";

/** Light / dark switch. Icon-only by default; pass `label` to show the action next to the icon. */
export function ThemeToggle({ className, label }: { className?: string; label?: boolean }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, getTheme, () => "light");
  const next: Theme = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  const text = next === "dark" ? "Dark mode" : "Light mode";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${text.toLowerCase()}`}
      title={`Switch to ${text.toLowerCase()}`}
      className={clsx("inline-flex items-center gap-3 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-foreground", className)}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label && <span className="whitespace-nowrap text-sm">{text}</span>}
    </button>
  );
}
