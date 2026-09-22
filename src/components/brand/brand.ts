/**
 * The single source of truth for the BTG AI brand.
 *
 * Every surface — marketing, auth, app, error and OAuth states — reads its
 * name, mark geometry and palette from here. The two stylesheets that theme
 * the product (`globals.css` for the dark app/auth surface, `landing.css` for
 * the light marketing surface) derive their colour tokens from these same
 * values, so there is exactly one place a brand change happens.
 */

export const BRAND = {
  /** Spoken name. Used in copy, aria labels and metadata. */
  name: "BTG AI",
  /** The wordmark is set in two parts so the accent half can be themed. */
  wordmark: { lead: "BTG", accent: "AI" },
  legalName: "BTG AI",
  tagline: "Learn. Build. Prove. Get matched.",
  promise:
    "Bridging the gap between education, AI capability, and opportunity — one verified skill at a time.",
  description:
    "BTG AI turns learning into proof: a personalized pathway, real projects, verified skills, and the opportunities they unlock.",
} as const;

/**
 * Canonical palette, in the hex form the marketing sheet and the SVG marks
 * need. `globals.css` restates the same hues in oklch for the dark surface;
 * these are the reference values both derive from.
 */
export const BRAND_PALETTE = {
  indigo: "#1E1B4B",
  violet: "#7C3AED",
  violetDark: "#6425E0",
  emerald: "#10B981",
  gold: "#F59E0B",
  ice: "#F8FAFC",
  slate: "#475569",
  nearBlack: "#0F172A",
} as const;

/** Canonical mark geometry — the "B" glyph, drawn once. */
export const BRAND_MARK = {
  viewBox: "0 0 30 30",
  tileRadius: 7,
  tileSize: 30,
  glyph:
    "M10 8h6.5c3.4 0 5.6 1.9 5.6 4.7 0 2-1.1 3.4-2.9 4 2.2.6 3.6 2.3 3.6 4.6 0 3.1-2.5 5.2-6 5.2H10V8Zm3 6.4h3c1.6 0 2.5-.8 2.5-2.1 0-1.3-.9-2.1-2.5-2.1h-3v4.2Zm0 7.4h3.4c1.8 0 2.9-.9 2.9-2.4 0-1.5-1.1-2.4-2.9-2.4H13v4.8Z",
} as const;

/**
 * Mark tones. The mark is never recoloured ad hoc: a surface picks the tone
 * that belongs to it.
 *   indigo — light surfaces (marketing header, email, favicon)
 *   violet — dark brand surfaces (marketing footer)
 *   onDark — the dark product surface (auth shell, app shell)
 */
export const BRAND_MARK_TONES = {
  indigo: { tile: BRAND_PALETTE.indigo, glyph: BRAND_PALETTE.ice },
  violet: { tile: BRAND_PALETTE.violet, glyph: BRAND_PALETTE.ice },
  onDark: { tile: BRAND_PALETTE.violet, glyph: BRAND_PALETTE.ice },
} as const;

export type BrandMarkTone = keyof typeof BRAND_MARK_TONES;

/**
 * Canonical product destinations. Marketing CTAs, auth cross-links and app
 * redirects all resolve through this map rather than literal strings.
 */
export const BRAND_ROUTES = {
  home: "/",
  signIn: "/sign-in",
  join: "/join",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  authCallback: "/auth/callback",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
} as const;
