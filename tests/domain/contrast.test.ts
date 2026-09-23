import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Readability is a contract, not a preference.
 *
 * This reads the real tokens out of globals.css and the real class usage out of
 * the lesson page, so it fails if either drifts. It is deliberately not a
 * snapshot: it asserts the WCAG threshold, which is the thing that matters.
 */

const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8");

/** OKLab -> linear sRGB, which is what the WCAG luminance formula expects. */
function oklchToLinearSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

function token(name: string): [number, number, number] {
  const match = css.match(new RegExp(`--color-${name}:\\s*oklch\\(([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)\\)`));
  if (!match) throw new Error(`token --color-${name} not found in globals.css`);
  return oklchToLinearSrgb(Number(match[1]), Number(match[2]), Number(match[3]));
}

const SURFACES = ["surface-0", "surface-1", "surface-2"] as const;

describe("text contrast meets WCAG AA", () => {
  it.each(SURFACES)("ink is readable on %s", (surface) => {
    expect(contrast(token("ink"), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SURFACES)("ink-muted is readable on %s", (surface) => {
    expect(contrast(token("ink-muted"), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SURFACES)("ink-subtle is readable on %s", (surface) => {
    // This is the token that regressed: at oklch(0.62 …) it measured 4.46:1 on
    // surface-2 and failed AA for normal text.
    expect(contrast(token("ink-subtle"), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the tokens visually ordered", () => {
    const onBase = (name: string) => contrast(token(name), token("surface-0"));
    expect(onBase("ink")).toBeGreaterThan(onBase("ink-muted"));
    expect(onBase("ink-muted")).toBeGreaterThan(onBase("ink-subtle"));
  });
});

describe("lesson instructional content is not muted", () => {
  const lesson = readFileSync(resolve(ROOT, "src/app/(app)/learn/[activityId]/page.tsx"), "utf8");

  it.each([
    ["description", "{content.description}"],
    ["learning objective", "{content.learning_objective.text}"],
    ["instructional body", "{section.text}"],
    ["remediation guidance", "{content.progression.remediation_rule.next_action}"],
  ])("renders the %s at full contrast", (_label, expression) => {
    // Find the element that renders this expression and assert it is not muted.
    const index = lesson.indexOf(expression);
    expect(index).toBeGreaterThan(-1);
    const element = lesson.slice(Math.max(0, lesson.lastIndexOf("<", index)), index);
    expect(element).not.toMatch(/text-ink-(muted|subtle)/);
    expect(element).toMatch(/text-ink\b/);
  });

  it("keeps lesson metadata on the subtle token", () => {
    // Domain, code, version and status are reference marks, not reading matter.
    expect(lesson).toMatch(/text-ink-subtle">\{lesson\.domain_code\}/);
  });
});
