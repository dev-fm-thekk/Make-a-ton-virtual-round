"use client";

import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { PASSWORD_RULES } from "@/lib/password";
import { Input } from "./ui";

type Props = Omit<ComponentProps<typeof Input>, "type"> & {
  /** When provided, shows the live rule checklist for this value. */
  watchValue?: string;
};

export function PasswordField({ watchValue, ...props }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Input {...props} type={show ? "text" : "password"} className="pr-10" />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2 top-[30px] rounded p-1 text-muted hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {watchValue !== undefined && (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(watchValue);
            return (
              <li key={r.id} className={ok ? "text-success" : "text-muted"}>
                <span className="inline-flex items-center gap-1.5">
                  {ok ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
                  {r.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
