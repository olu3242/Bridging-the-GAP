import * as React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { icon: Info, className: "border-accent/25 bg-accent/10 text-accent" },
  success: { icon: CheckCircle2, className: "border-success/25 bg-success/10 text-success" },
  error: { icon: AlertTriangle, className: "border-danger/30 bg-danger/10 text-danger" },
} as const;

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", toneClass, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-ink-muted">{children}</div> : null}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning";
  className?: string;
}) {
  const tones = {
    neutral: "border-white/12 bg-white/5 text-ink-muted",
    brand: "border-brand/35 bg-brand/15 text-ink",
    success: "border-success/30 bg-success/12 text-success",
    warning: "border-warning/30 bg-warning/12 text-warning",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-white/12 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-white/5 text-ink-subtle">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-ink-subtle">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="space-y-2">
      {label ? (
        <div className="flex items-center justify-between text-xs text-ink-subtle">
          <span>{label}</span>
          <span className="tabular-nums">{clamped}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/8"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-brand transition-[width] duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
