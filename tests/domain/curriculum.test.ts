import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildCurriculum, buildSeed, validateCurriculum } from "../../curriculum/build.mjs";
import { engineContract } from "../../curriculum/source/engine.mjs";

describe("canonical Batch 0 curriculum", () => {
  it("contains the exact domain allocation and 112 complete mapped contracts", () => {
    const { catalog, answerKeys } = buildCurriculum();
    const result = validateCurriculum(catalog, answerKeys);
    expect(result.errors).toEqual([]);
    expect(catalog.domains.map((d) => d.lesson_count)).toEqual([12,10,10,10,14,10,8,10,8,8,12]);
    expect(result.coverage).toMatchObject({ lessons:112,complete_contracts:112,questions:224,competencies:24,projects:11 });
    expect(new Set(catalog.lessons.map((l) => l.instructional_content[0].text)).size).toBe(112);
    expect(new Set(catalog.lessons.map((l) => l.worked_examples[0].scenario_and_walkthrough)).size).toBe(112);
    expect(new Set(catalog.lessons.map((l) => l.practice.instructions[0])).size).toBe(112);
  });

  it("rejects a title-only lesson and missing assessment coverage", () => {
    const { catalog, answerKeys } = buildCurriculum();
    catalog.lessons[0].instructional_content = [];
    answerKeys.pop();
    const result = validateCurriculum(catalog, answerKeys);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("AF01: instruction incomplete");
    expect(result.errors).toContain("VC12: assessment incomplete");
  });

  it("rejects cycles and orphan competency mappings", () => {
    const { catalog, answerKeys } = buildCurriculum();
    catalog.lessons[0].prerequisites = ["AF02"];
    catalog.lessons[0].competency_ids.push("invented-competency");
    const errors = validateCurriculum(catalog, answerKeys).errors;
    expect(errors).toContain("Prerequisite cycle: AF01");
    expect(errors).toContain("AF01: orphan competency");
  });

  it("never publishes required pending video or invents timestamps", () => {
    const { catalog, answerKeys } = buildCurriculum();
    expect(catalog.lessons.every((l) => l.status === "draft")).toBe(true);
    expect(catalog.videos.every((v) => v.verified_at === null && v.duration_seconds === null)).toBe(true);
    catalog.lessons[0].status = "published";
    expect(validateCurriculum(catalog, answerKeys).errors).toContain("AF01: unsafe publication");
  });

  it("keeps keys outside learner content and the draft SQL seed", () => {
    const { catalog, answerKeys } = buildCurriculum();
    const learnerArtifact = JSON.stringify(catalog);
    expect(learnerArtifact).not.toContain('"correct_option"');
    expect(learnerArtifact).not.toContain('"expected_response"');
    expect(buildSeed(catalog)).not.toContain("correct_option");
    expect(answerKeys).toHaveLength(112);
    expect(answerKeys.every((k) => k.reveal_policy.tutor === "never")).toBe(true);
  });

  it("maps every career capability to a reviewed project evidence path", () => {
    const { catalog } = buildCurriculum();
    const covered = new Set(catalog.projects.flatMap((p) => p.competency_evidence.map((e: { competency_id: string }) => e.competency_id)));
    for (const track of catalog.career_tracks) {
      for (const competency of track.required_competencies) expect(covered.has(competency)).toBe(true);
    }
    for (const requirement of catalog.credential_requirements) {
      const project = catalog.projects.find((p) => p.project_id === requirement.project_id)!;
      expect(project.review.human_required).toBe(true);
      expect(project.review.self_review).toBe(false);
      expect(requirement.qualifying_evidence.revoked_evidence_qualifies).toBe(false);
    }
    expect(catalog.projects.find((p) => p.lesson_id === "VC12")!.deliverables).toHaveLength(13);
  });

  it("reproduces committed artifacts deterministically", () => {
    const first = buildCurriculum();
    const second = buildCurriculum();
    expect(first).toEqual(second);
    expect(JSON.parse(readFileSync("curriculum/generated/catalog.v1.json", "utf8"))).toEqual(first.catalog);
    expect(JSON.parse(readFileSync("curriculum/generated/protected-assessments.v1.json", "utf8"))).toEqual(first.answerKeys);
    expect(readFileSync("supabase/seeds/curriculum-v1.sql", "utf8").replaceAll("\r\n", "\n")).toBe(buildSeed(first.catalog));
  });

  it("specifies every requested negative journey without claiming runtime certification", () => {
    expect(engineContract.negative_cases).toHaveLength(17);
    expect(new Set(engineContract.negative_cases.map((c) => c.id)).size).toBe(17);
    expect(engineContract.negative_cases.every((c) => c.expected.length > 30)).toBe(true);
    expect(engineContract.status).toBe("specified_for_batch_1_not_live_certified");
    expect(engineContract.assessment.supported_types).toHaveLength(7);
  });
});
