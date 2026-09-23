/**
 * The media state machine for a lesson's video requirement.
 *
 * This mirrors the gate inside `public.publish_curriculum_lesson` deliberately.
 * The SQL function remains the authority — this module never grants publication,
 * it only predicts and explains it, so an operator can see why a lesson is held
 * without attempting the publish. `tests/domain/curriculum-media.test.ts` pins
 * the two to the same rules; if the SQL gate changes, that test must fail.
 */

import type { CurriculumVideo, LessonVideoMapping } from "./types";

export type MediaState =
  | "not_required"
  | "unmapped"
  | "mapped"
  | "verification_pending"
  | "verified"
  | "unavailable";

export interface MediaAssessment {
  state: MediaState;
  /** True only when this lesson's video requirement cannot block publication. */
  satisfiesPublicationGate: boolean;
  /** Operator-facing reason. Empty when the gate is satisfied. */
  blocker: string;
  /** Learner-facing copy. Never blank, never implies a broken player. */
  learnerMessage: string;
  /** Whether playback may count toward progress. Only ever true when verified. */
  countsTowardProgress: boolean;
}

const PREPARING =
  "Video resource is being prepared. Continue with the lesson below.";

/**
 * Bounds must describe a real slice of the asset. A start at or past the end is
 * not a trimmed clip, it is a mapping error, and the SQL gate rejects it too.
 */
export function boundsAreValid(
  mapping: Pick<LessonVideoMapping, "start_seconds" | "end_seconds">,
  durationSeconds: number | null,
): boolean {
  if (durationSeconds == null) return false;
  const start = mapping.start_seconds ?? 0;
  const end = mapping.end_seconds ?? durationSeconds;
  return end > start && end <= durationSeconds;
}

export function assessLessonMedia(
  mapping: LessonVideoMapping | null,
  video: CurriculumVideo | null,
): MediaAssessment {
  // No mapping row at all: the contract never declared a video requirement.
  // The SQL gate treats this as a blocker, because an undeclared requirement is
  // indistinguishable from a forgotten one.
  if (!mapping) {
    return {
      state: "unmapped",
      satisfiesPublicationGate: false,
      blocker: "video requirement mapping missing",
      learnerMessage: PREPARING,
      countsTowardProgress: false,
    };
  }

  if (!mapping.required) {
    return {
      state: "not_required",
      satisfiesPublicationGate: true,
      blocker: "",
      learnerMessage:
        "This lesson does not use a video. Work through the material below and submit your evidence.",
      countsTowardProgress: false,
    };
  }

  if (!mapping.video_id) {
    return {
      state: "unmapped",
      satisfiesPublicationGate: false,
      blocker: "no candidate video mapped to this required-video lesson",
      learnerMessage: PREPARING,
      countsTowardProgress: false,
    };
  }

  // A candidate id is recorded but the asset row has not been ingested yet.
  if (!video) {
    return {
      state: "mapped",
      satisfiesPublicationGate: false,
      blocker: `candidate ${mapping.video_id} is mapped but no video asset record exists`,
      learnerMessage: PREPARING,
      countsTowardProgress: false,
    };
  }

  if (video.health_status === "unavailable") {
    return {
      state: "unavailable",
      satisfiesPublicationGate: false,
      blocker: `video ${video.video_id} is marked unavailable`,
      learnerMessage:
        "The video for this lesson is no longer available from its source. The full written lesson below covers the same material.",
      countsTowardProgress: false,
    };
  }

  const reasons: string[] = [];
  if (video.health_status !== "healthy") reasons.push("source, playback and embedding not verified");
  if (!mapping.relevance_verified_at) reasons.push("relevance to the lesson objective not verified");
  if (!boundsAreValid(mapping, video.duration_seconds)) reasons.push("start/end bounds are not within the asset duration");

  if (reasons.length) {
    return {
      state: "verification_pending",
      satisfiesPublicationGate: false,
      blocker: `video_pending: ${reasons.join("; ")}`,
      learnerMessage: PREPARING,
      countsTowardProgress: false,
    };
  }

  return {
    state: "verified",
    satisfiesPublicationGate: true,
    blocker: "",
    learnerMessage: "",
    countsTowardProgress: true,
  };
}

/** Counts by state, for the release console. */
export function summariseMedia(
  assessments: readonly MediaAssessment[],
): Record<MediaState, number> {
  const empty: Record<MediaState, number> = {
    not_required: 0,
    unmapped: 0,
    mapped: 0,
    verification_pending: 0,
    verified: 0,
    unavailable: 0,
  };
  for (const assessment of assessments) empty[assessment.state] += 1;
  return empty;
}
