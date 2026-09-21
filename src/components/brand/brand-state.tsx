import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BRAND } from "./brand";
import { BrandLogo } from "./brand-logo";

export type BrandStateTone = "neutral" | "error" | "denied";

const TONE_RING = {
  neutral: "ring-white/10",
  error: "ring-danger/30",
  denied: "ring-warning/30",
} as const;

/**
 * The branded standalone state: 404, unhandled error, access denied, and the
 * OAuth failure states. Every one of them carries the mark and the same
 * elevation as the product, so a failure never drops the visitor onto an
 * unbranded page.
 */
export function BrandStatePanel({
  code,
  title,
  description,
  tone = "neutral",
  children,
  className,
}: {
  code?: string;
  title: string;
  description: React.ReactNode;
  tone?: BrandStateTone;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-12 sm:px-5">
      <BrandLogo tone="onDark" size={32} className="self-start" />
      <div
        className={cn(
          "glass animate-rise rounded-[var(--radius-card)] px-5 py-7 text-center ring-1 sm:px-7",
          TONE_RING[tone],
          className,
        )}
      >
        {code ? <p className="font-mono text-xs tracking-widest text-ink-subtle">{code}</p> : null}
        <h1 className="mt-2 text-balance text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <div className="mt-2 text-sm text-ink-muted">{description}</div>
        {children ? <div className="mt-6 flex flex-col items-center gap-3">{children}</div> : null}
      </div>
      <p className="text-center text-xs text-ink-subtle">{BRAND.promise}</p>
    </div>
  );
}

/** The one place "you cannot see this" is rendered, so the copy cannot drift. */
export function AccessDeniedPanel({
  description = "Your account does not hold the permission this page needs. If that looks wrong, ask whoever administers your organization to grant it.",
  backHref = "/dashboard",
  backLabel = "Back to your dashboard",
}: {
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <BrandStatePanel code="403" title="You don't have access to this" description={description} tone="denied">
      <Button asChild variant="secondary">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </BrandStatePanel>
  );
}
