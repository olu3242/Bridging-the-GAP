import Link from "next/link";
import { cn } from "@/lib/utils";
import { BRAND, BRAND_MARK, BRAND_MARK_TONES, BRAND_ROUTES, type BrandMarkTone } from "./brand";

/**
 * The canonical brand mark. Inline SVG rather than an <img> because the tile
 * and glyph are themed per surface, and because the mark must render before
 * any network request resolves.
 */
export function BrandMark({
  size = 30,
  tone = "indigo",
  className,
}: {
  size?: number;
  tone?: BrandMarkTone;
  className?: string;
}) {
  const { tile, glyph } = BRAND_MARK_TONES[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox={BRAND_MARK.viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        width={BRAND_MARK.tileSize}
        height={BRAND_MARK.tileSize}
        rx={BRAND_MARK.tileRadius}
        fill={tile}
      />
      <path d={BRAND_MARK.glyph} fill={glyph} />
    </svg>
  );
}

export interface BrandLogoProps {
  /** Mark size in px. The wordmark scales from the surface's own type scale. */
  size?: number;
  tone?: BrandMarkTone;
  /** Wordmark styling: `product` uses design tokens, `landing` uses the marketing sheet. */
  variant?: "product" | "landing" | "landing-dark";
  /** Mark only — for compact headers and the favicon-sized slots. */
  markOnly?: boolean;
  /** Wraps the logo in a link. `false` renders a plain element (e.g. inside a footer that already links). */
  href?: string | false;
  className?: string;
}

/**
 * `<BrandLogo />` — the one component every surface uses to show the brand.
 *
 * Nothing else in the codebase draws the mark or sets the wordmark: a header,
 * an auth shell, a footer and an error state all render this, so the brand can
 * never drift between them.
 */
export function BrandLogo({
  size = 30,
  tone = "indigo",
  variant = "product",
  markOnly = false,
  href = BRAND_ROUTES.home,
  className,
}: BrandLogoProps) {
  const isLanding = variant !== "product";

  const content = (
    <>
      <span className={isLanding ? "brand-mark" : "inline-flex shrink-0"} aria-hidden="true">
        <BrandMark size={size} tone={tone} />
      </span>
      {markOnly ? null : isLanding ? (
        <span className={cn("brand-word", variant === "landing-dark" && "brand-word--dark")}>
          {BRAND.wordmark.lead} <em>{BRAND.wordmark.accent}</em>
        </span>
      ) : (
        <span className="font-semibold tracking-tight text-ink">
          {BRAND.wordmark.lead} <span className="text-brand">{BRAND.wordmark.accent}</span>
        </span>
      )}
    </>
  );

  const label = markOnly ? `${BRAND.name} home` : undefined;

  if (href === false) {
    return (
      <span className={cn(isLanding ? "brand" : "inline-flex items-center gap-2.5 text-sm", className)}>
        {content}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label ?? `${BRAND.name} home`}
      className={cn(
        isLanding ? "brand" : "inline-flex items-center gap-2.5 text-sm",
        !isLanding && "rounded-xl outline-offset-4",
        className,
      )}
    >
      {content}
    </Link>
  );
}
