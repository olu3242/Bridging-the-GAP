import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BRAND,
  BRAND_MARK,
  BRAND_MARK_TONES,
  BRAND_PALETTE,
  BRAND_ROUTES,
} from "@/components/brand/brand";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/**
 * The brand is a single source of truth or it is nothing. These assertions are
 * the mechanism that keeps it one: the two stylesheets and the two static marks
 * restate the canonical values in formats TypeScript cannot import, so each
 * restatement is checked against the module here.
 */
describe("brand source of truth", () => {
  it("states the name once, and the wordmark composes to it", () => {
    expect(`${BRAND.wordmark.lead} ${BRAND.wordmark.accent}`).toBe(BRAND.name);
  });

  it("exposes exactly the mark tones the surfaces use, all drawn from the palette", () => {
    const hexes = new Set<string>(Object.values(BRAND_PALETTE));
    expect(Object.keys(BRAND_MARK_TONES).sort()).toEqual(["indigo", "onDark", "violet"]);
    for (const [tone, { tile, glyph }] of Object.entries(BRAND_MARK_TONES)) {
      expect(hexes.has(tile), `${tone} tile is off-palette`).toBe(true);
      expect(hexes.has(glyph), `${tone} glyph is off-palette`).toBe(true);
      // A tile and glyph that match would render an invisible mark.
      expect(tile).not.toBe(glyph);
    }
  });

  it("keeps the marketing stylesheet on the canonical palette", () => {
    const css = read("src/app/(marketing)/landing.css");
    const declared: Record<string, string> = {
      "--indigo": BRAND_PALETTE.indigo,
      "--violet": BRAND_PALETTE.violet,
      "--violet-dark": BRAND_PALETTE.violetDark,
      "--emerald": BRAND_PALETTE.emerald,
      "--gold": BRAND_PALETTE.gold,
      "--ice": BRAND_PALETTE.ice,
      "--slate": BRAND_PALETTE.slate,
      "--near-black": BRAND_PALETTE.nearBlack,
    };
    for (const [token, hex] of Object.entries(declared)) {
      const match = css.match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`));
      expect(match, `${token} is not declared in landing.css`).not.toBeNull();
      expect(match?.[1]?.toUpperCase()).toBe(hex.toUpperCase());
    }
  });

  it("serves static marks that are the same glyph the component draws", () => {
    for (const asset of ["public/brand/favicon.svg", "public/brand/btg-mark.svg"]) {
      const svg = read(asset);
      expect(svg, `${asset} does not draw the canonical glyph`).toContain(BRAND_MARK.glyph);
      expect(svg).toContain(`viewBox="${BRAND_MARK.viewBox}"`);
      expect(svg).toContain(`rx="${BRAND_MARK.tileRadius}"`);
      // The favicon is rendered on light chrome, so it uses the indigo tone.
      expect(svg.toUpperCase()).toContain(BRAND_MARK_TONES.indigo.tile.toUpperCase());
      expect(svg.toUpperCase()).toContain(BRAND_MARK_TONES.indigo.glyph.toUpperCase());
    }
  });

  it("declares the mark once, at the root, so every route group inherits it", () => {
    const root = read("src/app/layout.tsx");
    expect(root).toContain("/brand/favicon.svg");
    // A group re-declaring icons is how the auth and app surfaces lost theirs.
    for (const group of ["src/app/(marketing)/layout.tsx", "src/app/(auth)/layout.tsx"]) {
      expect(read(group), `${group} re-declares the favicon`).not.toMatch(/icons\s*:/);
    }
  });

  it("gives every shell the canonical logo and no ad-hoc mark", () => {
    for (const shell of [
      "src/app/(auth)/layout.tsx",
      "src/components/app/app-shell.tsx",
      "src/components/landing/site-header.tsx",
      "src/components/landing/site-footer.tsx",
    ]) {
      const source = read(shell);
      expect(source, `${shell} does not render <BrandLogo />`).toContain("BrandLogo");
      // The placeholder that used to stand in for the mark on the product shells.
      expect(source, `${shell} still uses a stand-in mark`).not.toContain("Sparkles");
    }
  });

  it("routes both auth methods and recovery through one canonical route map", () => {
    expect(BRAND_ROUTES.authCallback).toBe("/auth/callback");
    for (const route of Object.values(BRAND_ROUTES)) {
      expect(route.startsWith("/")).toBe(true);
    }
  });
});
