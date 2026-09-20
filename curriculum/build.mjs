import { createHash } from 'node:crypto';
import ai from './source/ai.mjs';
import engineering from './source/engineering.mjs';
import professional from './source/professional.mjs';
import vibe from './source/vibe.mjs';
import { domains, competencies, additionalSkills, entryPrerequisites, starterMaterials, videoCandidates, careerTracks } from './source/catalog.mjs';

export function stableId(kind, key) {
  const hex = createHash('md5').update(`btg-curriculum:v1:${kind}:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

const vcDeliverables = ['requirements','architecture decisions','implementation','repository','Git history','working UI','backend/data where applicable','tests','security checks','deployment','E2E evidence','README','reflection'];

export function buildCurriculum() {
  const rows = [...ai, ...engineering, ...professional, ...vibe];
  const answerKeys = [];
  const projects = [];
  const lessons = rows.map(([id,title,objective,instruction,example,exercise,misconception], index) => {
    const prefix = id.slice(0,2);
    const domain = domains.find((d) => d[1] === prefix);
    const number = Number(id.slice(2));
    const project = number === domain[3];
    const skills = [...new Set([domain[5], ...(additionalSkills[id] ?? [])])];
    const objectiveId = `${id}.O1`;
    const moduleId = `${domain[0]}.M${number <= Math.ceil(domain[3]/2) ? '01' : '02'}`;
    const asset = videoCandidates.find((v) => v[2].includes(id));
    const checkpointId = `${id}.checkpoint.v1`;
    const practiceId = `${id}.practice.v1`;
    const truthfulStatement = instruction.split(/(?<=\.) /)[0];
    const statementIsTrue = index % 2 === 0;
    const rubric = [
      {id:'understanding',objective_id:objectiveId,competency_ids:skills,weight:25,minimum:3,
        criterion:`Explain and correctly apply: ${objective}`,
        anchors:['No relevant explanation','Repeats terms without applying them','Partly correct with a material conceptual error','Correct explanation applied to the case','Correct application plus a justified boundary or counterexample']},
      {id:'artifact',objective_id:objectiveId,competency_ids:skills,weight:25,minimum:3,
        criterion:`Deliver the requested work: ${exercise}`,
        anchors:['No artifact','Unrelated artifact','Partially completed or not inspectable','Complete artifact with traceable inputs and output','Complete reproducible artifact with clear reasoning and documented revisions']},
      {id:'verification',objective_id:objectiveId,competency_ids:skills,weight:25,minimum:3,
        criterion:`Check the lesson-specific failure illustrated here: ${misconception}`,
        anchors:['No check','Unsupported claim that it works','A check is described but its outcome is not recorded','A relevant check was executed and its actual outcome recorded','Normal and boundary checks recorded with limitations and a root-cause explanation']},
      {id:'integrity',objective_id:objectiveId,competency_ids:skills,weight:25,minimum:3,
        criterion:'Identify your contribution, sources, AI assistance, synthetic inputs and unexecuted work accurately; use only authorized data and test systems.',
        anchors:['Fabricated evidence or unauthorized activity','Missing provenance','Incomplete disclosure or ambiguous execution claims','Accurate provenance and disclosure with no unresolved authorization issue','Accurate provenance plus a clear audit trail and appropriate privacy minimization']},
    ];
    answerKeys.push({assessment_id:checkpointId,lesson_id:id,version:1,visibility:'server_and_authorized_assessor_only',
      answers:[{question_id:`${id}.Q1`,correct_option:statementIsTrue?'true':'false',explanation:instruction},
        {question_id:`${id}.Q2`,expected_response:`${instruction}\n\nReference application: ${example}`,rubric}],
      reveal_policy:{before_submission:'never',after_submission:'feedback_for_own_evaluated_attempt_only',active_retry:'withhold_reference_answer',tutor:'never'},
    });
    if(project) projects.push({project_id:`${id}.project.v1`,lesson_id:id,domain:domain[0],version:1,
      brief:title,problem:objective,requirements:[exercise,'Demonstrate the stated objective using inspectable artifacts and recorded checks.','Do not claim unexecuted work as completed.'],
      deliverables:id==='VC12'?vcDeliverables:[exercise,'source or input provenance','process/implementation record','actual validation results','limitations and reflection'],
      resources:[`curriculum://${id}/worked-example`],rubric,submission_type:'artifact_bundle',
      artifacts:{allowed:['text','repository_url','artifact_url','registered_file'],url_policy:'https_only_no_embedded_credentials',file_policy:'existing file_objects ownership and authorized storage checks'},
      review:{engine:'existing evidence/submission/review commands',human_required:true,self_review:false,claim_required:true,all_required_criteria:true},
      feedback:{required:true,criterion_scoped:true},revision:{append_only:true,prior_submissions_retained:true},
      approval:{minimum_score:75,minimum_each_criterion:3,unresolved_security_issue:'block',fabricated_evidence:'reject',
        deployment_required:['CL08','VC12'].includes(id),simulated_release_evidence_accepted:false},
      competency_evidence:skills.map((skill)=>({competency_id:skill,source:'approved_submission',proficiency_target:3})),
      portfolio:{visibility:'private_by_default',student_controls_sharing:true,requires_approved_evidence:true,
        fields:['title','problem','student_contribution','artifacts','repository_or_link','competencies','verification_state','outcome']},
    });
    return {
      lesson_id:id,activity_id:stableId('activity',id),slug:`curriculum-v1-${id.toLowerCase()}`,version:1,status:'draft',
      domain:domain[0],course:`${domain[0]}.C01`,module:moduleId,title,
      description:`${objective} Produce and defend the result of the accompanying ${project?'project':'practice'}.`,
      difficulty:project?'applied':number<=3?'beginner':'intermediate',estimated_minutes:project?180:45,
      prerequisites:number===1?entryPrerequisites[prefix]:[`${prefix}${String(number-1).padStart(2,'0')}`],
      learning_objective:{id:objectiveId,text:objective,competency_ids:skills},
      measurable_outcomes:[{id:`${id}.outcome.1`,text:objective,assessed_by:[`${id}.Q1`,`${id}.Q2`]},
        {id:`${id}.outcome.2`,text:exercise,assessed_by:[practiceId,`${id}.Q2`]},
        {id:`${id}.outcome.3`,text:`Explain why this misconception is unsafe or incorrect: ${misconception}`,assessed_by:[`${id}.Q2`]}],
      key_concepts:[{name:title,explanation:instruction},{name:'Decision boundary',explanation:example}],
      instructional_content:[{section_id:`${id}.instruction`,heading:'Understand the concept',text:instruction},
        {section_id:`${id}.worked-example`,heading:'Apply it to a concrete case',text:example},
        {section_id:`${id}.verification`,heading:'Inspect the result',text:`Use the method above on the practice task. Record the input, your decision, its supporting reason and the actual result of a check. Explain how your result avoids this mistake: ${misconception} A plan or generated claim is not evidence that a check ran.`}],
      worked_examples:[{id:`${id}.example.1`,scenario_and_walkthrough:example,transfer_task:exercise}],
      common_misconceptions:[{claim:misconception,correction:instruction}],
      resources:[{resource_id:`${id}.resource.1`,kind:'authored_instruction',uri:`curriculum://${id}/instruction`,provenance:'BTG AI original lesson text v1'},
        {resource_id:`${id}.resource.2`,kind:'worked_example',uri:`curriculum://${id}/worked-example`,provenance:'BTG AI synthetic teaching example v1'}],
      video:{video_required:!project,video_id:asset?.[0]??null,source_url:asset?`https://www.youtube.com/watch?v=${asset[0]}`:null,
        embed_url:asset?`https://www.youtube.com/embed/${asset[0]}`:null,provider:asset?'youtube':null,
        start_seconds:null,end_seconds:null,chapters:[],transcript:null,captions:null,verified_at:null,
        health_status:project?'not_required':asset?'needs_review':'video_pending',
        watch_threshold:project?null:0.85,relevance_status:asset?'candidate_mapping_unverified':'unmapped'},
      practice:{practice_id:practiceId,practice_type:project?'project':['SE','VC'].includes(prefix)?'practical':'structured_response',
        instructions:[exercise,'Inspect the worked example, make your own attempt, record the outcome and explain one limitation.','If a tool or environment is unavailable, save an explicitly unexecuted plan as a draft; it does not satisfy an execution requirement.'],
        starter_material:{worked_case:example,fixture:starterMaterials[prefix],fixture_is_synthetic:true},
        expected_outcome:{artifact:exercise,quality_standard:objective,verification:`Correctly reject this misconception: ${misconception}`},
        hints:[`Locate the decision rule in ${id}.instruction.`,`Compare your case with ${id}.worked-example and identify what changed.`,'Test the smallest example whose result you can check independently.'],
        submission_type:project?'artifact_bundle':'structured_response_with_artifact',
        submission_schema:{required:['decision','reasoning','artifact','verification','limitations','assistance_disclosure'],max_text_characters:4000,artifact_uses_existing_file_registry:true},
        persistence:{attempts:'append_only',idempotency_key:'learner+lesson_version+client_request_id',history:'retain_superseded_attempts'},
        evaluation:{human_required:true,rubric_ref:`${checkpointId}/Q2`,practice_alone_grants_mastery:false}},
      checkpoint:{assessment_id:checkpointId,version:1,questions:[
        {question_id:`${id}.Q1`,type:'true_false',objective_id:objectiveId,competency_ids:skills,
          prompt:`Evaluate this statement: ${statementIsTrue?truthfulStatement:misconception}`,options:[{id:'true',label:'True'},{id:'false',label:'False'}]},
        {question_id:`${id}.Q2`,type:project?'project':'structured_response',objective_id:objectiveId,competency_ids:skills,
          prompt:`Apply this objective: ${objective}\nTask: ${exercise}\nExplain your decision, submit the artifact, record a verification result and correct this misconception: ${misconception}`},
      ],answer_key_ref:`protected/${checkpointId}`,rubric_ref:`protected/${checkpointId}/Q2`,
        pass_threshold:{objective_check_percent:100,practical_percent:75,minimum_each_rubric_criterion:3},
        retry_policy:{maximum_attempts_per_cycle:3,after_failure:'targeted_remediation_before_retry',after_limit:'instructor_intervention_then_new_audited_cycle',retain_history:true,concurrent_active_attempts:1,resume_interrupted_attempt:true},
        evaluation:{Q1:'server_deterministic',Q2:'authorized_human_reviewer',ai_role:'audited_advisory_only',feedback:'objective_and_criterion_scoped',self_review:false}},
      competency_ids:skills,proficiency_target:project?3:2,
      evidence_required:{practice:'persisted own attempt with artifact provenance',checkpoint:'submitted and evaluated attempt',
        mastery:'approved project evidence linked through existing verified_skills',project_ref:project?`${id}.project.v1`:`${prefix}${String(domain[3]).padStart(2,'0')}.project.v1`},
      progression:{completion_rule:{all:['active_enrollment','pinned_published_version','prerequisites_completed','instruction_acknowledged',...(!project?['verified_video_threshold']:[]),'practice_accepted','checkpoint_passed',...(project?['project_approved']:[])],
          source_of_truth:'server-validated persisted records',page_open_is_completion:false,video_is_mastery:false},
        unlock_rule:{all_prerequisites_completed:true,server_authoritative:true},
        remediation_rule:{failed_objective:objectiveId,failed_criterion:'evaluation.criterion_id',reason:'evaluation.feedback',
          lesson_section:`${id}.instruction`,worked_example:`${id}.worked-example`,video_segment:null,video_segment_status:'pending_verification',
          practice_id:practiceId,next_action:'Review the failed criterion, repeat the linked practice with the hint, then submit a new attempt.',recalculate_mastery_only_after_qualifying_evidence:true},
        next_activity:project?`${id}.project.review`:`${prefix}${String(number+1).padStart(2,'0')}`},
    };
  });
  for(const project of projects) {
    const domainLessons=lessons.filter(l=>l.domain===project.domain);
    const domainSkills=[...new Set(domainLessons.flatMap(l=>l.competency_ids))];
    project.unlock_rule={required_lessons:domainLessons.filter(l=>l.lesson_id!==project.lesson_id).map(l=>l.lesson_id),
      project_lesson_may_be_in_progress:true,does_not_require_own_approval_or_course_completion:true};
    project.competency_evidence=domainSkills.map(skill=>({competency_id:skill,source:'approved_submission',proficiency_target:3}));
    project.competency_checks=domainSkills.map(skill=>({competency_id:skill,required:true,proficiency_target:3,
      standard:domainLessons.filter(l=>l.competency_ids.includes(skill)).map(l=>l.learning_objective.text),
      evidence_requirement:'Link the relevant lesson artifact and show its application in the capstone; the reviewer must verify the claimed capability against these standards.',
      source_lessons:domainLessons.filter(l=>l.competency_ids.includes(skill)).map(l=>l.lesson_id),
      approval_rule:'Every required standard is demonstrated by traceable project evidence; otherwise request revision and do not mint this skill.'}));
  }
  const catalog={schema_version:1,curriculum_id:'btg-canonical-112',version:1,status:'draft',
    provenance:'User-supplied Batch 0 canonical IDs, titles and domain counts; original instructional contracts authored for this repository.',
    domains:domains.map(([id,prefix,title,count,slug])=>({domain_id:id,prefix,title,slug,lesson_count:count,course_id:`${id}.C01`})),
    courses:domains.map(([id,prefix,title,count])=>({course_id:`${id}.C01`,domain:id,title,version:1,status:'draft',required_modules:[`${id}.M01`,`${id}.M02`],
      completion_rule:{required_modules:'completed',project:`${prefix}${String(count).padStart(2,'0')}.project.v1`,project_state:'approved'},credential_requirement_id:`${id}.credential.v1`})),
    modules:domains.flatMap(([id,prefix,,count])=>[1,2].map((part)=>({module_id:`${id}.M0${part}`,database_id:stableId('module',`${id}.M0${part}`),course:`${id}.C01`,version:1,status:'draft',
      title:part===1?'Foundations and guided practice':'Applied practice and project',required_lessons:lessons.filter(l=>l.module===`${id}.M0${part}`).map(l=>l.lesson_id),
      estimated_minutes:lessons.filter(l=>l.module===`${id}.M0${part}`).reduce((sum,l)=>sum+l.estimated_minutes,0),
      completion_rule:{required_lessons:'completed',assessment:`${prefix}${String(part===1?Math.ceil(count/2):count).padStart(2,'0')}.checkpoint.v1`,assessment_state:'passed'}}))),
    lessons,competencies:competencies.map(([id,title,domain])=>({competency_id:id,title,domain,proficiency_levels:['awareness','foundational','applied','proficient','advanced'],
      descriptors:[
        {level:1,label:'awareness',observable:`Recognize and explain the basic purpose of ${title.toLowerCase()} using the linked lesson examples.`,evidence:'diagnostic response; baseline estimate only'},
        {level:2,label:'foundational',observable:`Apply ${title.toLowerCase()} to guided practice and explain corrections using criterion feedback.`,evidence:'evaluated lesson artifacts; not independently verified mastery'},
        {level:3,label:'applied',observable:`Demonstrate ${title.toLowerCase()} in a reproducible project and satisfy its independent competency checks.`,evidence:'approved project submission linked to verified_skills'},
        {level:4,label:'proficient',observable:`Apply ${title.toLowerCase()} independently to varied cases and explain tradeoffs and failure recovery.`,evidence:'multiple independently reviewed projects with explicit level-4 criteria; not automatically granted by this curriculum'},
        {level:5,label:'advanced',observable:`Evaluate and improve ${title.toLowerCase()} approaches across unfamiliar constraints and justify the results.`,evidence:'advanced independent review against explicit level-5 criteria; not automatically granted by this curriculum'},
      ],
      mastery_rule:{qualifying_source:'approved_project_evidence',minimum_proficiency:3,never_from:['page_open','watch_event','AI_claim','self_report','unreviewed_practice']}})),
    projects,
    diagnostic_blueprint:competencies.map(([id])=>{const probe=lessons.find(l=>l.competency_ids.includes(id));return {
      competency_id:id,question_ref:`${probe.lesson_id}.Q1`,protected_key_ref:`protected/${probe.checkpoint.assessment_id}`,
      maximum_estimated_level:1,correct_response_level:1,incorrect_response_level:0,
      interpretation:'A single recognition probe is a provisional awareness estimate, not proof of applied capability.',
      qualifying_mastery:false,follow_up_lesson:probe.lesson_id,applied_evidence_route:projects.find(p=>p.competency_evidence.some(e=>e.competency_id===id)).project_id,
    };}),
    videos:videoCandidates.map(([id,title,mappings])=>({video_id:id,candidate_title:title,provider:'youtube',source_url:`https://www.youtube.com/watch?v=${id}`,embed_url:`https://www.youtube.com/embed/${id}`,
      source:'user_supplied_candidate',metadata_verified:false,creator:null,duration_seconds:null,transcript:null,captions:null,chapters:[],verified_at:null,health_status:'needs_review',
      verification_requirements:['resolve_url','confirm_identity','confirm_accessibility','confirm_embedding','review_relevance','capture_actual_metadata_and_segments','render_test'],candidate_lessons:mappings})),
    lesson_video:lessons.filter(l=>l.video.video_id).map(l=>({lesson_id:l.lesson_id,version:1,video_id:l.video.video_id,start_seconds:null,end_seconds:null,relevance_verified:false,status:'needs_review'})),
    objective_competency:lessons.flatMap(l=>l.competency_ids.map(id=>({objective_id:l.learning_objective.id,competency_id:id,lesson_id:l.lesson_id}))),
    credential_requirements:domains.map(([id,prefix,,count])=>{const project=projects.find(p=>p.domain===id);return {
      requirement_id:`${id}.credential.v1`,course_id:`${id}.C01`,version:1,required_lessons:lessons.filter(l=>l.domain===id).map(l=>l.lesson_id),
      project_id:`${prefix}${String(count).padStart(2,'0')}.project.v1`,required_competencies:project.competency_evidence,
      qualifying_evidence:{source:'approved_submission',review_required:true,revoked_evidence_qualifies:false},
      issuance:{engine:'existing credential definitions and issue_eligible_credentials',idempotency_key:'recipient+definition_version',
        required_fields:['credential_id','type','recipient','competencies','evidence','issued_at','verification_identifier','expiration','revocation','history'],expiration_policy:'none_unless_definition_sets_duration',revocation:'authorized_reasoned_audited',history:'append_only'},
    };}),
    career_tracks:careerTracks.map(([id,title,skills])=>({track_id:id,title,required_competencies:skills,learner_can_accept_or_change:true,
      gap_rule:'required competency minus current qualifying evidence',recommendation_explanation:'name missing competency, current evidence, relevant lesson and unmet prerequisite',employability_score:null})),
  };
  return {catalog,answerKeys};
}

export function validateCurriculum(catalog, answerKeys) {
  const errors=[];
  const check=(condition,message)=>{if(!condition)errors.push(message);};
  const ids=new Set(catalog.lessons.map(l=>l.lesson_id));
  const skills=new Set(catalog.competencies.map(c=>c.competency_id));
  const keys=new Map(answerKeys.map(k=>[k.assessment_id,k]));
  check(catalog.domains.length===11,'Expected exactly 11 canonical domains');
  check(catalog.lessons.length===112 && ids.size===112,'Expected exactly 112 unique lessons');
  check(new Set(catalog.lessons.map(l=>l.slug)).size===112,'Duplicate lesson slug');
  check(new Set(catalog.lessons.map(l=>l.activity_id)).size===112,'Duplicate activity identity');
  check(catalog.projects.length===11,'Expected 11 applied projects');
  for(const domain of catalog.domains){
    check(domains.some(d=>d[0]===domain.domain_id && d[1]===domain.prefix && d[3]===domain.lesson_count),`Noncanonical domain allocation: ${domain.domain_id}`);
    check(catalog.lessons.filter(l=>l.domain===domain.domain_id).length===domain.lesson_count,`Wrong count: ${domain.domain_id}`);
    for(let i=1;i<=domain.lesson_count;i++)check(ids.has(`${domain.prefix}${String(i).padStart(2,'0')}`),`Missing canonical ID: ${domain.prefix}${i}`);
  }
  for(const l of catalog.lessons){
    const key=keys.get(l.checkpoint?.assessment_id);
    check(Boolean(l.learning_objective?.text?.length>20),`${l.lesson_id}: objective missing`);
    check(l.instructional_content?.length>=3 && l.instructional_content.every(s=>s.text.length>80),`${l.lesson_id}: instruction incomplete`);
    check(l.worked_examples?.length>0 && l.common_misconceptions?.length>0,`${l.lesson_id}: teaching support missing`);
    check(l.measurable_outcomes?.length>=3 && l.key_concepts?.length>=2 && l.resources?.length>0,`${l.lesson_id}: incomplete learning contract`);
    check(Number.isInteger(l.estimated_minutes) && l.estimated_minutes>0 && l.estimated_minutes<=240,`${l.lesson_id}: invalid estimated duration`);
    check(['beginner','intermediate','applied'].includes(l.difficulty),`${l.lesson_id}: invalid difficulty`);
    check(Boolean(l.practice?.starter_material && l.practice?.expected_outcome && l.practice.instructions.length),`${l.lesson_id}: practice incomplete`);
    check(l.checkpoint?.questions.length>=2 && key?.answers.length===l.checkpoint.questions.length,`${l.lesson_id}: assessment incomplete`);
    check(l.checkpoint.retry_policy.maximum_attempts_per_cycle===3 && l.checkpoint.retry_policy.retain_history,`${l.lesson_id}: invalid retry contract`);
    check(l.practice.submission_type && l.practice.hints.length>0 && l.practice.evaluation.human_required,`${l.lesson_id}: incomplete practice contract`);
    check(l.competency_ids.length>0 && l.competency_ids.every(c=>skills.has(c)),`${l.lesson_id}: orphan competency`);
    check(l.prerequisites.every(p=>ids.has(p)&&p!==l.lesson_id),`${l.lesson_id}: invalid prerequisite`);
    check(catalog.modules.some(m=>m.module_id===l.module && m.required_lessons.includes(l.lesson_id)),`${l.lesson_id}: orphan module`);
    check(l.progression.completion_rule.all.includes('checkpoint_passed') && l.progression.completion_rule.all.includes('practice_accepted'),`${l.lesson_id}: incomplete completion rule`);
    check(l.progression.remediation_rule.practice_id===l.practice.practice_id,`${l.lesson_id}: orphan remediation`);
    check(ids.has(l.progression.next_activity) || catalog.projects.some(p=>`${p.lesson_id}.project.review`===l.progression.next_activity),`${l.lesson_id}: invalid next activity`);
    check(l.status==='draft' || !l.video.video_required || l.video.health_status==='healthy',`${l.lesson_id}: unsafe publication`);
    if(l.video.video_id)check(catalog.videos.some(v=>v.video_id===l.video.video_id && v.source_url===l.video.source_url),`${l.lesson_id}: unknown video URL`);
    if(l.video.health_status!=='healthy')check(l.video.verified_at===null && l.video.start_seconds===null && l.video.end_seconds===null,`${l.lesson_id}: invented verification metadata`);
    for(const q of l.checkpoint.questions){
      check(q.objective_id===l.learning_objective.id && q.competency_ids.every(c=>l.competency_ids.includes(c)),`${l.lesson_id}: orphan question mapping`);
      check(!('correct_option' in q) && !('expected_response' in q),`${l.lesson_id}: answer exposed`);
    }
    check(key?.visibility==='server_and_authorized_assessor_only',`${l.lesson_id}: unprotected key`);
    check(catalog.projects.some(p=>p.project_id===l.evidence_required.project_ref),`${l.lesson_id}: missing evidence route`);
  }
  const visiting=new Set(),visited=new Set();
  const walk=(id)=>{if(visiting.has(id)){errors.push(`Prerequisite cycle: ${id}`);return;}if(visited.has(id))return;visiting.add(id);const l=catalog.lessons.find(l=>l.lesson_id===id);for(const p of l?.prerequisites??[])walk(p);visiting.delete(id);visited.add(id);};
  for(const id of ids)walk(id);
  for(const p of catalog.projects){
    check(p.rubric.length>=4 && p.rubric.every(r=>r.anchors.length===5 && skills.has(r.competency_ids[0])) && p.review.human_required && !p.review.self_review,`${p.project_id}: invalid review rubric`);
    check(p.competency_checks.length>0 && p.competency_checks.every(c=>c.standard.length>0 && c.source_lessons.every(id=>ids.has(id))),`${p.project_id}: incomplete competency evidence`);
    check(!p.unlock_rule.required_lessons.includes(p.lesson_id) && p.unlock_rule.required_lessons.every(id=>ids.has(id)),`${p.project_id}: circular project unlock`);
  }
  for(const r of catalog.credential_requirements)check(catalog.projects.some(p=>p.project_id===r.project_id) && r.required_competencies.every(c=>skills.has(c.competency_id)) && r.qualifying_evidence.review_required,`${r.requirement_id}: broken evidence chain`);
  for(const t of catalog.career_tracks)check(t.required_competencies.every(c=>skills.has(c)),`${t.track_id}: orphan career competency`);
  for(const c of catalog.competencies){
    check(catalog.projects.some(p=>p.competency_evidence.some(e=>e.competency_id===c.competency_id)),`${c.competency_id}: no qualifying evidence path`);
    check(catalog.diagnostic_blueprint.some(d=>d.competency_id===c.competency_id && d.maximum_estimated_level===1),`${c.competency_id}: no bounded diagnostic probe`);
  }
  for(const mapping of catalog.objective_competency)check(catalog.lessons.some(l=>l.lesson_id===mapping.lesson_id && l.learning_objective.id===mapping.objective_id && l.competency_ids.includes(mapping.competency_id)),`Orphan objective mapping: ${mapping.objective_id}`);
  check(catalog.lessons.filter(l=>l.video.video_required && l.video.health_status!=='healthy').every(l=>l.status==='draft'),'Required pending videos must block publication');
  return {valid:errors.length===0,errors,coverage:{domains:catalog.domains.length,lessons:catalog.lessons.length,complete_contracts:errors.length?null:catalog.lessons.length,
    assessments:catalog.lessons.length,questions:catalog.lessons.reduce((sum,l)=>sum+l.checkpoint.questions.length,0),competencies:skills.size,projects:catalog.projects.length,
    video_assets:catalog.videos.length,verified_videos:catalog.videos.filter(v=>v.health_status==='healthy').length,pending_video_assets:catalog.videos.filter(v=>v.health_status!=='healthy').length,
    video_required_lessons:catalog.lessons.filter(l=>l.video.video_required).length,pending_video_lessons:catalog.lessons.filter(l=>l.video.video_required&&l.video.health_status!=='healthy').length,
    mapped_video_lessons:catalog.lesson_video.length,unmapped_video_lessons:catalog.lessons.filter(l=>l.video.video_required&&!l.video.video_id).length,
    published_lessons:catalog.lessons.filter(l=>l.status==='published').length}};
}

const quote=(value)=>`'${String(value).replaceAll("'","''")}'`;
export function buildSeed(catalog) {
  const lines=['-- Generated by scripts/build-curriculum.mjs; do not edit.',
    '-- Batch 0 draft seed, applied transactionally by Batch 1 after its runtime guards exist.',
    '-- Does not publish lessons, enroll learners, replace existing IDs, or issue evidence.',
    '-- Full versioned contracts and protected assessment keys are separate JSON artifacts.',
    '-- Existing domain/competency identities are resolved by slug; legacy rows remain intact.'];
  for(const d of catalog.domains)lines.push(`insert into public.competency_domains(id,slug,name,sort_order) values (${quote(stableId('domain',d.domain_id))},${quote(d.slug)},${quote(d.title)},${Number(d.domain_id.slice(1))}) on conflict (slug) do nothing;`);
  for(const c of catalog.competencies){const d=catalog.domains.find(d=>d.domain_id===c.domain);lines.push(`insert into public.competencies(id,domain_id,slug,name,target_level,evidence_requirement) select ${quote(stableId('competency',c.competency_id))},id,${quote(c.competency_id)},${quote(c.title)},3,'Approved project submission with rubric review and traceable artifacts.' from public.competency_domains where slug=${quote(d.slug)} on conflict (slug) do nothing;`);}
  for(const m of catalog.modules){const d=catalog.domains.find(d=>m.course===`${d.domain_id}.C01`);const primary=domains.find(row=>row[0]===d.domain_id)[5];
    lines.push(`insert into public.learning_modules(id,competency_id,slug,title,summary,target_level,estimated_minutes,status,sort_order) select ${quote(m.database_id)},id,${quote(`curriculum-v1-${m.module_id.toLowerCase().replaceAll('.','-')}`)},${quote(`${d.title}: ${m.title}`)},'Draft canonical curriculum v1; publication requires Batch 1 assessment, video and progression gates.',3,${m.estimated_minutes},'draft',${Number(m.module_id.slice(-2))} from public.competencies where slug=${quote(primary)} on conflict (slug) do nothing;`);}
  for(const l of catalog.lessons){const learningModule=catalog.modules.find(m=>m.module_id===l.module);const body=l.instructional_content.map(s=>`${s.heading}\n${s.text}`).join('\n\n');
    lines.push(`insert into public.learning_activities(id,module_id,slug,title,kind,body,requires_output,estimated_minutes,sort_order) values (${quote(l.activity_id)},${quote(learningModule.database_id)},${quote(l.slug)},${quote(l.title)},${quote(l.practice.practice_type==='project'?'lab':'lesson')},${quote(body)},true,${l.estimated_minutes},${Number(l.lesson_id.slice(2))}) on conflict (module_id,slug) do nothing;`);}
  return lines.join('\n')+'\n';
}

export function buildRuntimeSeed(catalog,answerKeys) {
  return buildSeed(catalog)+`
-- Immutable v1 contract import. Future content versions need new migrations.
insert into btg.curriculum_manifests(version,document) values (1,${quote(JSON.stringify(catalog))}::jsonb)
on conflict (version) do nothing;
insert into public.curriculum_lessons(activity_id,module_id,lesson_code,version,domain_code,course_code,contract)
select (l->>'activity_id')::uuid,a.module_id,l->>'lesson_id',(l->>'version')::integer,l->>'domain',l->>'course',l
from btg.curriculum_manifests m cross join lateral jsonb_array_elements(m.document->'lessons') l
join public.learning_activities a on a.id=(l->>'activity_id')::uuid where m.version=1
on conflict(activity_id) do nothing;
insert into btg.curriculum_assessment_keys(activity_id,definition)
select l.activity_id,k from jsonb_array_elements(${quote(JSON.stringify(answerKeys))}::jsonb) k
join public.curriculum_lessons l on l.lesson_code=k->>'lesson_id' and l.version=(k->>'version')::integer
on conflict(activity_id) do nothing;
insert into public.curriculum_videos(video_id,source_url,embed_url,candidate_title)
select v->>'video_id',v->>'source_url',v->>'embed_url',v->>'candidate_title'
from btg.curriculum_manifests m cross join lateral jsonb_array_elements(m.document->'videos') v where m.version=1
on conflict(video_id) do nothing;
insert into public.curriculum_lesson_video(activity_id,video_id,required,threshold)
select activity_id,contract#>>'{video,video_id}',(contract#>>'{video,video_required}')::boolean,
coalesce((contract#>>'{video,watch_threshold}')::numeric,0.85) from public.curriculum_lessons where version=1
on conflict(activity_id) do nothing;
`;
}
