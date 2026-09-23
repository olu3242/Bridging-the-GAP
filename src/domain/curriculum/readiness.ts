/**
 * Release readiness: pure derivation from the facts the database reports.
 *
 * This lives in the domain layer because it decides nothing about access and
 * performs no IO — it turns `curriculum_release_readiness()` rows into the
 * counts and blocker lists the console renders. Keeping it pure is what lets
 * `tests/domain/curriculum-release.test.ts` exercise it directly.
 */
import { assessLessonMedia, summariseMedia, type MediaAssessment, type MediaState } from "./media-state";

/** One row of `public.curriculum_release_readiness()`. */
export interface ReadinessRow {
  activity_id: string;
  lesson_code: string;
  domain_code: string;
  version: number;
  status: string;
  title: string;
  assessment_ready: boolean;
  prerequisites: string[];
  prerequisites_unpublished: string[];
  video_required: boolean;
  video_mapped: boolean;
  video_health: "needs_review" | "healthy" | "unavailable" | null;
  video_relevance_verified: boolean;
  video_duration_seconds: number | null;
  video_start_seconds: number | null;
  video_end_seconds: number | null;
  video_mapping_present: boolean;
}

export interface LessonReadiness extends ReadinessRow {
  media: MediaAssessment;
  /** Ordered root-cause-first, matching the bulk publisher's report. */
  blockers: string[];
  ready: boolean;
}

export interface ReleaseSummary {
  total: number;
  draft: number;
  published: number;
  ready: number;
  mediaBlocked: number;
  prerequisiteBlocked: number;
  assessmentBlocked: number;
  media: Record<MediaState, number>;
  byDomain: { domain_code: string; total: number; published: number; ready: number; blocked: number }[];
  lessons: LessonReadiness[];
}

/**
 * Derives readiness from the database's own facts.
 *
 * The blocker order matches `publish_ready_curriculum_lessons`: a lesson's own
 * assessment and media come before a prerequisite, because a prerequisite
 * failure is downstream of some other lesson's media and resolves itself.
 */
export function deriveReadiness(rows: readonly ReadinessRow[]): ReleaseSummary {
  const lessons: LessonReadiness[] = rows.map((row) => {
    const media = assessLessonMedia(
      row.video_mapping_present
        ? {
            video_id: row.video_mapped ? "mapped" : null,
            required: row.video_required,
            threshold: 0,
            start_seconds: row.video_start_seconds,
            end_seconds: row.video_end_seconds,
            relevance_verified_at: row.video_relevance_verified ? "verified" : null,
          }
        : null,
      row.video_mapped && row.video_health
        ? {
            video_id: "mapped",
            source_url: "",
            embed_url: "",
            candidate_title: "",
            health_status: row.video_health,
            duration_seconds: row.video_duration_seconds,
            transcript: null,
          }
        : null,
    );

    const blockers: string[] = [];
    if (!row.assessment_ready) blockers.push("protected assessment definition missing");
    if (!row.video_mapping_present) blockers.push("video requirement mapping missing");
    else if (!media.satisfiesPublicationGate) blockers.push(media.blocker);
    if (row.prerequisites_unpublished.length) {
      blockers.push(`prerequisite curriculum is not published: ${row.prerequisites_unpublished.join(", ")}`);
    }

    return { ...row, media, blockers, ready: row.status === "draft" && blockers.length === 0 };
  });

  const drafts = lessons.filter((lesson) => lesson.status === "draft");
  const domains = [...new Set(lessons.map((lesson) => lesson.domain_code))].sort();

  return {
    total: lessons.length,
    draft: drafts.length,
    published: lessons.filter((lesson) => lesson.status === "published").length,
    ready: lessons.filter((lesson) => lesson.ready).length,
    // A lesson is counted once, against its root cause, so the buckets sum to
    // the blocked total rather than double-counting the 97 that fail both.
    mediaBlocked: drafts.filter((lesson) => lesson.assessment_ready && !lesson.media.satisfiesPublicationGate).length,
    prerequisiteBlocked: drafts.filter(
      (lesson) => lesson.assessment_ready && lesson.media.satisfiesPublicationGate && lesson.prerequisites_unpublished.length > 0,
    ).length,
    assessmentBlocked: drafts.filter((lesson) => !lesson.assessment_ready).length,
    media: summariseMedia(lessons.map((lesson) => lesson.media)),
    byDomain: domains.map((code) => {
      const inDomain = lessons.filter((lesson) => lesson.domain_code === code);
      return {
        domain_code: code,
        total: inDomain.length,
        published: inDomain.filter((lesson) => lesson.status === "published").length,
        ready: inDomain.filter((lesson) => lesson.ready).length,
        blocked: inDomain.filter((lesson) => lesson.status === "draft" && lesson.blockers.length > 0).length,
      };
    }),
    lessons,
  };
}
