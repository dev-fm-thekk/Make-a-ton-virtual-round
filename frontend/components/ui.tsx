"use client";

// Minimal design-system primitives. Teammates: build new screens from these so everything looks consistent.
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type Ref, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

// ───────── Button ─────────
type Variant = "primary" | "secondary" | "ghost" | "danger";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  size?: "sm" | "md";
}

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-surface border border-border hover:bg-surface-2",
  ghost: "hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({ variant = "primary", loading, size = "md", className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        size === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-xs",
        variants[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ───────── Field wrapper + Input + Select ─────────
export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

const control =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-ring disabled:opacity-60";

export function Input({ label, error, hint, id, className, ref, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode; ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid}>
      <input id={fid} ref={ref} aria-invalid={!!error} className={clsx(control, error && "border-danger", className)} {...rest} />
    </Field>
  );
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={clsx(control, "pr-8", className)} />;
}

export function SelectField({ label, error, hint, id, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: ReactNode }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid}>
      <select id={fid} aria-invalid={!!error} {...rest} className={clsx(control, "pr-8", error && "border-danger", className)}>
        {children}
      </select>
    </Field>
  );
}

export function Textarea({ label, error, hint, id, className, ref, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: ReactNode; ref?: Ref<HTMLTextAreaElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} error={error} hint={hint} htmlFor={fid}>
      <textarea id={fid} ref={ref} aria-invalid={!!error} rows={3} className={clsx(control, "h-auto py-2", error && "border-danger", className)} {...rest} />
    </Field>
  );
}

/** A labelled checkbox with an optional explanation underneath (settings like "Active", "Make default"). */
export function CheckboxField({ label, hint, id, className, ref, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; hint?: ReactNode; ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={clsx("flex items-start gap-3", className)}>
      <input id={fid} ref={ref} type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--primary)]" {...rest} />
      <label htmlFor={fid} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-muted">{hint}</span>}
      </label>
    </div>
  );
}

// ───────── Card / Badge / Alert ─────────
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-xl border border-border bg-surface shadow-sm", className)}>{children}</div>;
}

const tones = {
  neutral: "bg-surface-2 text-muted",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  primary: "bg-primary/15 text-primary",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "success"; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={clsx("rounded-lg px-3 py-2 text-sm", tone === "danger" ? "bg-danger/10 text-danger" : "bg-success/10 text-success")}>
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} aria-label="Loading" />;
}

// ───────── Modal ─────────
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx("m-auto w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/50", wide ? "max-w-2xl" : "max-w-md")}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-surface-2">
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

// ───────── Page header ─────────
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
