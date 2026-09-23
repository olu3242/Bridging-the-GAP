/**
 * Learner-facing grouping of the canonical domains.
 *
 * This is presentation only. The 11 domains and 112 lesson contracts remain the
 * canonical inventory; a pathway is a lens over them, never a second catalog.
 * Nothing here creates, duplicates or reorders lesson records, and no pathway
 * grants access — visibility is still decided by RLS and lesson status.
 */

export const CURRICULUM_DOMAINS = {
  D01: "AI Foundations",
  D02: "AI Productivity",
  D03: "Prompt & Context Engineering",
  D04: "AI Agents & Automation",
  D05: "Software Engineering",
  D06: "Data & Analytics",
  D07: "Cloud & Modern Technology",
  D08: "Cybersecurity & Responsible AI",
  D09: "Career & Professional Skills",
  D10: "Entrepreneurship & Innovation",
  D11: "Vibe Coding",
} as const;

export type DomainCode = keyof typeof CURRICULUM_DOMAINS;

export interface Pathway {
  id: string;
  title: string;
  /** One sentence a learner can act on, not a marketing line. */
  summary: string;
  /** Canonical domain codes, in the order a learner should meet them. */
  domains: readonly DomainCode[];
}

/**
 * Order matters: FOUNDATION first because every other pathway assumes it.
 * The domain order inside BUILD is deliberate (D11 before D05) — vibe coding is
 * the gentler entry into building, and the engineering domain reads better after it.
 */
export const PATHWAYS: readonly Pathway[] = [
  {
    id: "FOUNDATION",
    title: "Foundation",
    summary: "How AI systems actually behave, and how to direct them precisely.",
    domains: ["D01", "D02", "D03"],
  },
  {
    id: "BUILD",
    title: "Build",
    summary: "Turn direction into working software, agents and deployed systems.",
    domains: ["D11", "D05", "D04", "D07"],
  },
  {
    id: "DATA",
    title: "Data",
    summary: "Collect, question and defend the evidence behind a decision.",
    domains: ["D06"],
  },
  {
    id: "TRUST",
    title: "Trust",
    summary: "Secure what you build and judge where it should not be used.",
    domains: ["D08"],
  },
  {
    id: "WORK",
    title: "Work",
    summary: "Convert demonstrated skill into work others will pay for.",
    domains: ["D09"],
  },
  {
    id: "CREATE",
    title: "Create",
    summary: "Take an idea from problem statement to something people use.",
    domains: ["D10"],
  },
] as const;

/** Every canonical domain appears in exactly one pathway. Pinned by tests. */
export const PATHWAY_BY_DOMAIN: Readonly<Record<DomainCode, Pathway>> = Object.freeze(
  Object.fromEntries(
    PATHWAYS.flatMap((pathway) => pathway.domains.map((domain) => [domain, pathway])),
  ) as Record<DomainCode, Pathway>,
);

export function isDomainCode(value: string): value is DomainCode {
  return Object.prototype.hasOwnProperty.call(CURRICULUM_DOMAINS, value);
}

export function pathwayFor(domainCode: string): Pathway | null {
  return isDomainCode(domainCode) ? PATHWAY_BY_DOMAIN[domainCode] : null;
}

export function domainTitle(domainCode: string): string {
  return isDomainCode(domainCode) ? CURRICULUM_DOMAINS[domainCode] : domainCode;
}

export interface GroupedLesson {
  domain_code: string;
}

/**
 * Groups lessons under their pathway without dropping any. A lesson whose domain
 * is not canonical is surfaced under `unplaced` rather than silently discarded —
 * losing a lesson is worse than showing it in an odd place.
 */
export function groupByPathway<T extends GroupedLesson>(
  lessons: readonly T[],
): { pathway: Pathway; domains: { code: string; title: string; lessons: T[] }[] }[] & { unplaced?: T[] } {
  const grouped = PATHWAYS.map((pathway) => ({
    pathway,
    domains: pathway.domains
      .map((code) => ({
        code: code as string,
        title: CURRICULUM_DOMAINS[code],
        lessons: lessons.filter((lesson) => lesson.domain_code === code),
      }))
      .filter((domain) => domain.lessons.length > 0),
  })).filter((entry) => entry.domains.length > 0);

  const unplaced = lessons.filter((lesson) => !isDomainCode(lesson.domain_code));
  return unplaced.length ? Object.assign(grouped, { unplaced }) : grouped;
}
