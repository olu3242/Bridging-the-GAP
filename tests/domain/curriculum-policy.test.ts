import { describe, expect, it } from "vitest";
import { buildCurriculum } from "../../curriculum/build.mjs";
import { completionDecision, evaluateCheckpoint, gradeClosedQuestion, publicationBlockers } from "../../curriculum/assessment-policy.mjs";

describe("curriculum assessment and progression contract", () => {
  const { catalog, answerKeys } = buildCurriculum();
  const lesson=catalog.lessons[0];
  const key=answerKeys[0];
  const submitted=()=>({assessment_id:lesson.checkpoint.assessment_id,attempt_id:"attempt-1",learner_id:"learner",lesson_version:1,status:"submitted",
    responses:{[key.answers[0].question_id]:key.answers[0].correct_option,[key.answers[1].question_id]:{artifact:"own work",reasoning:"own explanation"}}});
  const reviewer=()=>({reviewer_id:"reviewer",authorized:true,rationale:"Criterion-specific review recorded against the submitted artifact.",scores:{understanding:3,artifact:3,verification:3,integrity:3},integrity_issue:false,unresolved_security_issue:false});

  it("fails a weak attempt, targets the same objective, and permits a separately reviewed retry without granting mastery", () => {
    const first=submitted();
    first.responses[key.answers[0].question_id]=key.answers[0].correct_option==="true"?"false":"true";
    const failed=evaluateCheckpoint(lesson,key,first,reviewer());
    expect(failed.status).toBe("needs_remediation");
    expect(failed.next_action).toMatchObject({failed_objective:"AF01.O1",lesson_section:"AF01.instruction",practice_id:"AF01.practice.v1"});
    const retry={...submitted(),attempt_id:"attempt-2"};
    const passed=evaluateCheckpoint(lesson,key,retry,reviewer());
    expect(passed.status).toBe("passed");
    expect(passed.mastery_granted).toBe(false);
    expect(passed.credential_granted).toBe(false);
    expect(failed.status).toBe("needs_remediation");
  });

  it("requires submission, pinned version, independent review and all rubric scores", () => {
    expect(()=>evaluateCheckpoint(lesson,key,{...submitted(),status:"in_progress"},reviewer())).toThrow(/Submit/);
    expect(()=>evaluateCheckpoint(lesson,key,{...submitted(),lesson_version:2},reviewer())).toThrow(/version/);
    expect(()=>evaluateCheckpoint(lesson,key,submitted(),{...reviewer(),reviewer_id:"learner"})).toThrow(/independent/);
    expect(()=>evaluateCheckpoint(lesson,key,submitted(),{...reviewer(),authorized:false})).toThrow(/authorized/);
    expect(()=>evaluateCheckpoint(lesson,key,submitted(),{...reviewer(),scores:{}})).toThrow(/score/);
  });

  it("does not average away a failed security or integrity requirement", () => {
    expect(evaluateCheckpoint(lesson,key,submitted(),{...reviewer(),unresolved_security_issue:true}).status).toBe("needs_remediation");
    expect(evaluateCheckpoint(lesson,key,submitted(),{...reviewer(),scores:{understanding:4,artifact:4,verification:4,integrity:2}}).status).toBe("needs_remediation");
  });

  it("keeps viewing, practice, assessment and project evidence as separate gates", () => {
    expect(completionDecision(lesson,{verified_video_threshold:true}).can_complete).toBe(false);
    const records=Object.fromEntries(lesson.progression.completion_rule.all.map(gate=>[gate,true]));
    expect(completionDecision(lesson,records)).toMatchObject({can_complete:true,grants_mastery:false,grants_credential:false});
    expect(completionDecision(lesson,{...records,prerequisites_completed:false}).missing).toContain("prerequisites_completed");
  });

  it("rejects required videos without complete verification and does not fabricate a healthy asset", () => {
    for(const l of catalog.lessons.filter(l=>l.video.video_required))expect(publicationBlockers(l,null)).toContain("required_video_unverified");
    expect(publicationBlockers(lesson,{video_id:lesson.video.video_id,source_url:lesson.video.source_url,verified_at:"2026-09-19",duration_seconds:100,checks:{resolved_url:true}})).toContain("required_video_unverified");
  });

  it("grades supported closed questions without treating duplicate selections as a valid set", () => {
    expect(gradeClosedQuestion("multi_select",["b","a"],["a","b"])).toBe(true);
    expect(gradeClosedQuestion("multi_select",["a","a"],["a","b"])).toBe(false);
    expect(gradeClosedQuestion("mcq","a","b")).toBe(false);
    expect(()=>gradeClosedQuestion("project","a","a")).toThrow(/human/);
  });
});
