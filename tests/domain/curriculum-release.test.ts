import { describe, expect, it } from "vitest";
import {
  CURRICULUM_DOMAINS,
  PATHWAYS,
  groupByPathway,
  pathwayFor,
  domainTitle,
} from "@/domain/curriculum/pathways";
import { assessLessonMedia, boundsAreValid, summariseMedia } from "@/domain/curriculum/media-state";
import { deriveReadiness, type ReadinessRow } from "@/domain/curriculum/readiness";
import type { CurriculumVideo, LessonVideoMapping } from "@/domain/curriculum/types";

const mapping = (over: Partial<LessonVideoMapping> = {}): LessonVideoMapping => ({
  video_id: "abcdefghijk",
  required: true,
  threshold: 0.8,
  start_seconds: 0,
  end_seconds: 300,
  relevance_verified_at: "2026-09-23T00:00:00Z",
  ...over,
});

const video = (over: Partial<CurriculumVideo> = {}): CurriculumVideo => ({
  video_id: "abcdefghijk",
  source_url: "https://www.youtube.com/watch?v=abcdefghijk",
  embed_url: "https://www.youtube.com/embed/abcdefghijk",
  candidate_title: "Example",
  health_status: "healthy",
  duration_seconds: 600,
  transcript: null,
  ...over,
});

describe("curriculum pathways", () => {
  it("places all eleven canonical domains in exactly one pathway", () => {
    const placed = PATHWAYS.flatMap((pathway) => pathway.domains);
    expect(placed.length).toBe(Object.keys(CURRICULUM_DOMAINS).length);
    expect(new Set(placed).size).toBe(placed.length);
    for (const code of Object.keys(CURRICULUM_DOMAINS)) expect(pathwayFor(code)).not.toBeNull();
  });

  it("uses the mandated pathway composition", () => {
    const byId = Object.fromEntries(PATHWAYS.map((pathway) => [pathway.id, pathway.domains]));
    expect(byId.FOUNDATION).toEqual(["D01", "D02", "D03"]);
    expect(byId.BUILD).toEqual(["D11", "D05", "D04", "D07"]);
    expect(byId.DATA).toEqual(["D06"]);
    expect(byId.TRUST).toEqual(["D08"]);
    expect(byId.WORK).toEqual(["D09"]);
    expect(byId.CREATE).toEqual(["D10"]);
  });

  it("groups without duplicating or dropping a lesson", () => {
    const lessons = Object.keys(CURRICULUM_DOMAINS).flatMap((code) => [
      { domain_code: code, id: `${code}-a` },
      { domain_code: code, id: `${code}-b` },
    ]);
    const grouped = groupByPathway(lessons);
    const seen = grouped.flatMap((entry) => entry.domains.flatMap((domain) => domain.lessons));
    expect(seen.length).toBe(lessons.length);
    expect(new Set(seen.map((lesson) => lesson.id)).size).toBe(lessons.length);
  });

  it("surfaces an unknown domain rather than silently discarding it", () => {
    const grouped = groupByPathway([{ domain_code: "D99" }]);
    expect((grouped as { unplaced?: unknown[] }).unplaced).toHaveLength(1);
    expect(domainTitle("D99")).toBe("D99");
  });
});

describe("lesson media state", () => {
  it("treats a missing mapping as a blocker, matching the SQL gate", () => {
    const assessment = assessLessonMedia(null, null);
    expect(assessment.state).toBe("unmapped");
    expect(assessment.satisfiesPublicationGate).toBe(false);
    expect(assessment.blocker).toContain("mapping missing");
  });

  it("lets a lesson that needs no video through the gate", () => {
    const assessment = assessLessonMedia(mapping({ required: false, video_id: null, relevance_verified_at: null }), null);
    expect(assessment.state).toBe("not_required");
    expect(assessment.satisfiesPublicationGate).toBe(true);
    expect(assessment.countsTowardProgress).toBe(false);
  });

  it("reports an unmapped required video with intentional learner copy", () => {
    const assessment = assessLessonMedia(mapping({ video_id: null, relevance_verified_at: null }), null);
    expect(assessment.state).toBe("unmapped");
    expect(assessment.learnerMessage).toBe("Video resource is being prepared. Continue with the lesson below.");
    expect(assessment.satisfiesPublicationGate).toBe(false);
  });

  it("distinguishes a mapped candidate from a verified one", () => {
    expect(assessLessonMedia(mapping(), null).state).toBe("mapped");
    expect(assessLessonMedia(mapping(), video({ health_status: "needs_review" })).state).toBe("verification_pending");
    expect(assessLessonMedia(mapping({ relevance_verified_at: null }), video()).state).toBe("verification_pending");
  });

  it("keeps the lesson readable when a video is unavailable", () => {
    const assessment = assessLessonMedia(mapping(), video({ health_status: "unavailable" }));
    expect(assessment.state).toBe("unavailable");
    expect(assessment.learnerMessage).toContain("written lesson below");
    expect(assessment.countsTowardProgress).toBe(false);
  });

  it("only counts verified playback toward progress", () => {
    const verified = assessLessonMedia(mapping(), video());
    expect(verified.state).toBe("verified");
    expect(verified.countsTowardProgress).toBe(true);
    expect(verified.satisfiesPublicationGate).toBe(true);
    for (const state of ["mapped", "verification_pending", "unavailable", "unmapped", "not_required"]) {
      expect(verified.state).not.toBe(state);
    }
  });

  it("rejects bounds that fall outside the asset", () => {
    expect(boundsAreValid({ start_seconds: 0, end_seconds: 300 }, 600)).toBe(true);
    expect(boundsAreValid({ start_seconds: 300, end_seconds: 300 }, 600)).toBe(false);
    expect(boundsAreValid({ start_seconds: 0, end_seconds: 900 }, 600)).toBe(false);
    expect(boundsAreValid({ start_seconds: 0, end_seconds: 300 }, null)).toBe(false);
    // A bad slice is a pending verification, never a verified video.
    expect(assessLessonMedia(mapping({ end_seconds: 900 }), video()).state).toBe("verification_pending");
  });

  it("summarises states for the console", () => {
    const summary = summariseMedia([
      assessLessonMedia(mapping(), video()),
      assessLessonMedia(mapping({ video_id: null, relevance_verified_at: null }), null),
      assessLessonMedia(mapping({ required: false, video_id: null, relevance_verified_at: null }), null),
    ]);
    expect(summary).toMatchObject({ verified: 1, unmapped: 1, not_required: 1 });
  });
});

describe("release readiness derivation", () => {
  const row = (over: Partial<ReadinessRow> = {}): ReadinessRow => ({
    activity_id: "00000000-0000-0000-0000-000000000001",
    lesson_code: "AF01",
    domain_code: "D01",
    version: 1,
    status: "draft",
    title: "Lesson",
    assessment_ready: true,
    prerequisites: [],
    prerequisites_unpublished: [],
    video_required: true,
    video_mapped: true,
    video_health: "healthy",
    video_relevance_verified: true,
    video_duration_seconds: 600,
    video_start_seconds: 0,
    video_end_seconds: 300,
    video_mapping_present: true,
    ...over,
  });

  it("marks a fully-gated lesson ready", () => {
    const summary = deriveReadiness([row()]);
    expect(summary.ready).toBe(1);
    expect(summary.lessons[0].blockers).toEqual([]);
  });

  it("counts each blocked lesson once, against its root cause", () => {
    // Fails both its own media gate and the prerequisite gate. The prerequisite
    // failure is downstream, so this counts as media-blocked, not both.
    const summary = deriveReadiness([
      row({ video_health: "needs_review", prerequisites_unpublished: ["AF00"] }),
    ]);
    expect(summary.mediaBlocked).toBe(1);
    expect(summary.prerequisiteBlocked).toBe(0);
    expect(summary.ready).toBe(0);
    // Both reasons are still reported, so nothing is hidden from the operator.
    expect(summary.lessons[0].blockers).toHaveLength(2);
  });

  it("reports a prerequisite block only when media is already satisfied", () => {
    const summary = deriveReadiness([row({ video_required: false, video_mapped: false, video_health: null, video_relevance_verified: false, prerequisites_unpublished: ["AF11"] })]);
    expect(summary.prerequisiteBlocked).toBe(1);
    expect(summary.mediaBlocked).toBe(0);
    expect(summary.lessons[0].blockers[0]).toContain("AF11");
  });

  it("aggregates per domain", () => {
    const summary = deriveReadiness([
      row({ lesson_code: "AF01", domain_code: "D01", status: "published" }),
      row({ lesson_code: "VC01", domain_code: "D11", video_health: "needs_review" }),
    ]);
    expect(summary.byDomain).toEqual([
      { domain_code: "D01", total: 1, published: 1, ready: 0, blocked: 0 },
      { domain_code: "D11", total: 1, published: 0, ready: 0, blocked: 1 },
    ]);
  });
});
