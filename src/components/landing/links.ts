/**
 * Canonical href → product destination map.
 *
 * btg-ai-landing/index.html points every call to action at a placeholder
 * anchor (`#get-started`, `#login`). This is the single place those become
 * real product entries, so a CTA audit reads as one table rather than a grep
 * across components.
 */
export const LANDING_LINKS = {
  /** In-page anchors are preserved exactly as the canonical design has them. */
  top: "#top",
  howItWorks: "#how-it-works",
  modules: "#modules",
  partners: "#partners",
  faq: "#faq",

  /** `#login` in the canonical design. */
  signIn: "/sign-in",
  /** `#get-started` in the canonical design. */
  getStarted: "/join",
} as const;

/**
 * The partner cards all pointed at `#get-started`. Each now carries the
 * persona it is recruiting for, so onboarding can pre-select it instead of
 * asking the visitor to re-state what they just clicked.
 */
export function getStartedAs(intent: "institution" | "employer" | "sponsor"): string {
  return `${LANDING_LINKS.getStarted}?intent=${intent}`;
}
