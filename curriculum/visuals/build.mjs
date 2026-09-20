import { createHash } from 'node:crypto';
import { buildCurriculum, stableId } from '../build.mjs';
import { slots, validateManifest } from './schema.mjs';
import prototypes from './prototypes.mjs';
import { existsSync,readFileSync } from 'node:fs';

export const colors={background:'#141724',surface:'#202538',text:'#F5F6FA',muted:'#CBD2E1',border:'#66728C',proposal:'#C4B5FD',review:'#93C5FD',verified:'#86EFAC',warning:'#FDE68A',denied:'#FDA4AF',evidence:'#67E8F9',data:'#67E8F9'};
const purposes={cover:'Identify the lesson and its central decision at a glance.',concept:'Explain the relationship or process behind the canonical learning objective.',worked_example:'Make the authored worked example observable without changing its facts.',misconception:'Contrast the encoded misconception with the lesson’s supported decision rule.',practice_evidence:'Structure the learner’s own practice and traceable evidence without supplying assessed answers.'};
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const hash=s=>createHash('sha256').update(s).digest('hex');
const slug=slot=>slot.replaceAll('_','-');
const css=`:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:${colors.background};color:${colors.text};font:16px/1.5 system-ui,sans-serif}main{max-width:960px;margin:auto;padding:32px}h1{font-size:32px;line-height:1.25;margin:8px 0 24px}h2{font-size:24px}p{max-width:76ch}.eyebrow,figcaption{color:${colors.muted}}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.node,.panel{background:${colors.surface};border:2px solid ${colors.border};border-radius:16px;padding:20px;min-width:0;overflow-wrap:anywhere}.node strong{font-size:20px;display:block}.node small{display:block;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px}.node p{margin-bottom:0}.contrast{display:grid;grid-template-columns:1fr 1fr;gap:24px}.proposal{border-style:dashed}.verified{border-style:double;border-width:4px}.denied{border-style:solid}.motif{font-size:40px;line-height:1.2;max-width:20ch;padding:32px 0}.worksheet{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.blank{min-height:96px;margin-top:8px;border-top:1px dashed ${colors.border}}.row{margin:24px 0}.counter{font-family:monospace;color:${colors.muted}}details{margin:24px 0}summary{cursor:pointer;padding:12px;border:2px solid ${colors.border};border-radius:8px}:focus-visible{outline:3px solid ${colors.evidence};outline-offset:3px}svg{width:100%;height:auto}footer{margin-top:32px;border-top:1px solid ${colors.border};padding-top:16px;color:${colors.muted}}@media(max-width:600px){main{padding:20px}h1{font-size:28px}.grid,.contrast,.worksheet{grid-template-columns:1fr}.motif{font-size:32px}}@media print{body{background:white;color:black}.node,.panel{background:white;color:black;break-inside:avoid}footer{color:black}.eyebrow,figcaption,.counter{color:#333}}`;
const node=([title,detail,state],index)=>`<div class="node ${state}" style="border-color:${colors[state]}"><small style="color:${colors[state]}">${index+1} · ${escape(state)}</small><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`;
function thumbnail(l,slot,p){
  const labels=slot==='misconception'?['Assumption','Check the boundary','Supported decision']:slot==='practice_evidence'?p.fields.slice(0,3):p.concept.map(n=>n[0]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270" role="img" aria-labelledby="title desc"><title id="title">${escape(l.lesson_id+' '+slot)}</title><desc id="desc">${escape(p.motif)}</desc><rect width="480" height="270" rx="16" fill="${colors.background}"/><text x="24" y="36" fill="${colors.muted}" font-family="sans-serif" font-size="16">${escape(l.lesson_id+' · '+slot.replaceAll('_',' '))}</text>${labels.map((label,i)=>`<rect x="24" y="${58+i*62}" width="432" height="48" rx="10" fill="${colors.surface}" stroke="${colors.border}" stroke-width="2"/><text x="40" y="${89+i*62}" fill="${colors.text}" font-family="sans-serif" font-size="18">${escape(label)}</text>`).join('')}</svg>`;
}
function render(l,slot,p,a){
  let body;
  if(slot==='cover')body=`<p class="motif">${escape(p.motif)}</p><div class="grid">${p.concept.map(node).join('')}</div>`;
  if(slot==='concept')body=`<p>${escape(l.learning_objective.text)}</p><div class="grid">${p.concept.map(node).join('')}</div><p class="eyebrow">${['AF01','SE10'].includes(l.lesson_id)?'Related roles and relationships; order does not imply a time sequence.':'Read the numbered stages in order. Each handoff must satisfy the stated boundary.'}</p>`;
  if(slot==='worked_example')body=`<p>${escape(l.worked_examples[0].scenario_and_walkthrough)}</p><div class="grid">${p.example.map(node).join('')}</div><p class="eyebrow">Authored teaching example. This is not a learner result or a live system observation.</p>`;
  if(slot==='misconception')body=`<div class="contrast"><section class="panel"><h2>Assumption to challenge</h2><p>${escape(l.practice.expected_outcome.verification.replace('Correctly reject this misconception: ',''))}</p></section><section class="panel"><h2>Supported decision</h2><p>${escape(p.correction)}</p></section></div><p class="eyebrow">An assumption and a verified result are different states.</p>`;
  if(slot==='practice_evidence')body=`<p>${escape(l.practice.instructions[0])}</p><p>Complete the fields with your own work. Copy your evidence into the lesson’s saved practice form. This printable board does not save or submit responses.</p>${Array.from({length:p.rows},(_,i)=>`<section class="row"><h2>Case ${i+1}</h2><div class="worksheet">${p.fields.map(field=>`<div class="panel"><strong>${escape(field)}</strong><div class="blank" aria-label="Blank space for your own response"></div></div>`).join('')}</div></section>`).join('')}<p>Record limitations, source references and AI assistance. Label checks you did not execute as unexecuted.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escape(a.title)}</title><style>${css}</style></head><body><main><p class="eyebrow">BTG AI · ${escape(l.domain)} · ${escape(l.lesson_id)} · ${escape(slot.replaceAll('_',' '))}</p><h1>${escape(l.title)}</h1><figure style="margin:0">${body}<figcaption style="margin-top:24px">${escape(a.caption)}</figcaption></figure><details><summary>Text equivalent and source</summary><p>${escape(a.extended_description)}</p><p>Canonical lesson ${escape(l.lesson_id)}, curriculum version ${l.version}. Source hash: <span style="overflow-wrap:anywhere">${a.provenance.source_hash}</span></p></details><footer>Reference prototype · Needs human review · Visuals do not grant completion, evidence approval, mastery or credentials.</footer></main></body></html>`;
}

export function buildVisuals({rasterCovers=true}={}){
  const {catalog}=buildCurriculum();
  const files=new Map();
  const manifests=catalog.lessons.map(l=>{
    const p=prototypes[l.lesson_id];
    const source={objective:l.learning_objective.text,instruction:l.instructional_content,example:l.worked_examples[0].scenario_and_walkthrough,practice:l.practice.instructions,misconception:l.practice.expected_outcome.verification};
    const visuals=Object.fromEntries(slots.map(slot=>{
      const base=`curriculum/assets/visuals/${l.lesson_id.slice(0,2)}/${l.lesson_id}/${slug(slot)}/generated/${l.lesson_id}-${slug(slot)}`;
      const selected=slot==='worked_example'?source.example:slot==='practice_evidence'?source.practice.join('\n'):slot==='misconception'?source.misconception:source.objective;
      const purpose=l.practice.practice_type==='project'&&slot==='practice_evidence'?'Organize the capstone objective, artifacts, verification, acceptance criteria, submissions, blockers and definition of done.':purposes[slot];
      const a={id:stableId('visual',`${l.lesson_id}:${slot}:v1`),activity_id:l.activity_id,lesson_id:l.lesson_id,domain_id:l.domain,curriculum_version_id:l.version,
        visual_type:slot,learning_purpose:purpose,title:`${l.lesson_id} · ${l.title} · ${slot.replaceAll('_',' ')}`,
        caption:`${purpose} ${source.objective}`,alt_text:`${slot.replaceAll('_',' ')} for ${l.title}: ${source.objective}`,
        extended_description:`${selected}\n\n${source.example}\n\n${p?.correction??source.objective}`,
        format:'html',asset_path:p?`${base}-v1.html`:null,thumbnail_path:p?`${base}-thumbnail-v1.svg`:null,width:960,height:540,aspect_ratio:'960:540',
        source_type:'deterministic_template',generation_prompt:`LESSON ID: ${l.lesson_id}\nLESSON: ${l.title}\nDOMAIN: ${l.domain}\nVISUAL SLOT: ${slot}\nCANONICAL OBJECTIVE: ${source.objective}\nLEARNING PURPOSE: ${purpose}\nCANONICAL SOURCE MATERIAL: ${selected}\nVISUAL STORY: ${p?.motif??'Pending authored composition; do not substitute generic artwork.'}\nREQUIRED ELEMENTS: exact source meaning, labeled boundaries, semantic equivalent\nOPTIONAL ELEMENTS: domain accent and relevant line icons\nPROHIBITED ELEMENTS: protected answers, invented facts, fabricated outcomes, robots or magical AI\nSTYLE: BTG AI canonical visual system v1\nDOMAIN ACCENT: shared indigo, violet and cyan system; semantics take precedence\nTEXT POLICY: short labels; full explanation remains HTML\nACCESSIBILITY: non-color cues, high contrast, reflow, keyboard access\nFORMAT: HTML and SVG thumbnail\nASPECT RATIO: 960:540 nominal canvas; HTML height reflows\nOUTPUT FILE: ${base}-v1.html`,generation_model:null,
        provenance:{source_refs:[`${l.lesson_id}.instruction`,`${l.lesson_id}.worked-example`,l.practice.practice_id],source_hash:hash(JSON.stringify(source)),renderer_version:'btg-visuals-1',asset_hash:null},
        status:p?'needs_review':'generation_pending',version:1,created_at:p?'2026-09-20T00:00:00.000Z':null,reviewed_at:null,reviewed_by:null,published_at:null,review_reason:null};
      if(p){const html=render(l,slot,p,a);a.provenance.asset_hash=hash(html);files.set(a.asset_path,html);files.set(a.thumbnail_path,thumbnail(l,slot,p));}
      return [slot,a];
    }));
    const manifest={schema_version:1,lesson_id:l.lesson_id,activity_id:l.activity_id,curriculum_version_id:l.version,visuals};
    const errors=validateManifest(manifest,l,{readFile:path=>files.get(path)});
    if(errors.length)throw new Error(`${l.lesson_id}: ${errors.join('; ')}`);
    return manifest;
  });
  if(rasterCovers&&existsSync('curriculum/visuals/reference-covers.json')){
    const covers=JSON.parse(readFileSync('curriculum/visuals/reference-covers.json','utf8'));
    for(const m of manifests){const cover=covers[m.lesson_id];if(!cover)continue;
      const a=m.visuals.cover;
      Object.assign(a,{id:stableId('visual',`${m.lesson_id}:cover:v2`),version:2,format:'webp',width:1600,height:900,aspect_ratio:'1600:900',
        asset_path:cover.asset_path,thumbnail_path:cover.thumbnail_path,alt_text:cover.alt_text,
        source_type:'image_generation',generation_prompt:cover.generation_prompt,generation_provider:cover.generation_provider,
        generation_model:null,responsive_variants:cover.responsive_variants});
      a.provenance.asset_hash=cover.asset_hash;
      a.provenance.source_refs.push(cover.source_path);
    }
  }
  const assets=manifests.flatMap(m=>Object.values(m.visuals));
  const coverage={domains:catalog.domains.length,lessons:manifests.length,target_slots:assets.length,rendered:assets.filter(a=>a.asset_path).length,pending:assets.filter(a=>!a.asset_path).length,approved:assets.filter(a=>a.status==='approved').length,published:assets.filter(a=>a.status==='published').length};
  return {manifests,files,coverage};
}
