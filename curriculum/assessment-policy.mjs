// Executable contract policy for Batch 1. This module performs no writes and
// is not an authorization boundary. The server must load trusted records under
// the canonical actor/RLS context before calling it.
export function publicationBlockers(lesson, verification) {
  const blockers=[];
  if(!lesson.instructional_content?.length || !lesson.practice || !lesson.checkpoint)blockers.push('incomplete_contract');
  if(lesson.video.video_required){
    const required=['resolved_url','confirmed_identity','accessible_playback','embeddable','reviewed_relevance','real_metadata','render_test','accessible_equivalent'];
    if(!verification || verification.video_id!==lesson.video.video_id || verification.source_url!==lesson.video.source_url
      || !verification.verified_at || !Number.isFinite(verification.duration_seconds) || verification.duration_seconds<=0
      || required.some(check=>verification.checks?.[check]!==true))blockers.push('required_video_unverified');
  }
  return blockers;
}

export function gradeClosedQuestion(type, response, expected) {
  if(type==='multi_select'){
    if(!Array.isArray(response)||!Array.isArray(expected)||new Set(response).size!==response.length)return false;
    return response.length===expected.length && response.every(id=>expected.includes(id));
  }
  if(!['mcq','true_false'].includes(type))throw new Error('A human rubric is required for this question type.');
  return typeof response==='string' && response===expected;
}

export function evaluateCheckpoint(lesson,key,attempt,review) {
  if(attempt.status!=='submitted')throw new Error('Submit the attempt before evaluation.');
  if(attempt.assessment_id!==lesson.checkpoint.assessment_id || key.assessment_id!==attempt.assessment_id
    || attempt.lesson_version!==lesson.version)throw new Error('Assessment version mismatch.');
  if(!review.authorized || review.reviewer_id===attempt.learner_id)throw new Error('An authorized independent reviewer is required.');
  if(!review.rationale?.trim())throw new Error('Review rationale is required.');
  const closed=key.answers[0];
  const closedPass=gradeClosedQuestion(lesson.checkpoint.questions[0].type,attempt.responses[closed.question_id],closed.correct_option);
  const rubric=key.answers[1].rubric;
  const criterionResults=rubric.map(criterion=>{
    const score=review.scores[criterion.id];
    if(!Number.isInteger(score)||score<0||score>4)throw new Error(`Missing or invalid rubric score: ${criterion.id}`);
    return {criterion_id:criterion.id,score,weight:criterion.weight,passed:score>=criterion.minimum,objective_id:criterion.objective_id};
  });
  if(!attempt.responses[lesson.checkpoint.questions[1].question_id])throw new Error('Practical response is required.');
  const practicalPercent=criterionResults.reduce((sum,c)=>sum+(c.score/4)*c.weight,0);
  const passed=closedPass && practicalPercent>=lesson.checkpoint.pass_threshold.practical_percent && criterionResults.every(c=>c.passed)
    && !review.integrity_issue && !review.unresolved_security_issue;
  return {assessment_id:attempt.assessment_id,attempt_id:attempt.attempt_id,lesson_version:lesson.version,
    status:passed?'passed':'needs_remediation',closed_question_passed:closedPass,practical_percent:practicalPercent,
    criteria:criterionResults,feedback:review.rationale,
    next_action:passed?'check_remaining_completion_gates':lesson.progression.remediation_rule,
    mastery_granted:false,credential_granted:false};
}

export function completionDecision(lesson,records) {
  const missing=lesson.progression.completion_rule.all.filter(gate=>records[gate]!==true);
  return {can_complete:missing.length===0,missing,grants_mastery:false,grants_credential:false};
}
