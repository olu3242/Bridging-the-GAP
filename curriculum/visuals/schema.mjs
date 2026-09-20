import { z } from 'zod';

export const slots = ['cover','concept','worked_example','misconception','practice_evidence'];
export const statuses = ['draft','generation_pending','generated','needs_review','approved','published','rejected','retired'];
const localPath = z.string().regex(/^curriculum\/assets\/visuals\/[A-Z]{2}\/[A-Z]{2}\d{2}\/[a-z-]+\/(source|generated|approved|published)\/[A-Za-z0-9.-]+$/);
export const assetSchema = z.object({
  id:z.guid(), activity_id:z.guid(), lesson_id:z.string().regex(/^[A-Z]{2}\d{2}$/), domain_id:z.string().regex(/^D\d{2}$/),
  curriculum_version_id:z.number().int().positive(), visual_type:z.enum(slots), learning_purpose:z.string().min(20),
  title:z.string().min(5), caption:z.string().min(20), alt_text:z.string().min(20).max(360), extended_description:z.string().min(40),
  format:z.enum(['svg','html','webp','avif','png']), asset_path:localPath.nullable(), thumbnail_path:localPath.nullable(),
  width:z.number().int().positive(),height:z.number().int().positive(),aspect_ratio:z.string(),
  source_type:z.enum(['deterministic_template','image_generation','authored_diagram','verified_screenshot']),
  generation_prompt:z.string().min(100),generation_model:z.string().nullable(),
  generation_provider:z.string().optional(),
  responsive_variants:z.array(localPath).optional(),
  provenance:z.object({source_refs:z.array(z.string()).min(1),source_hash:z.string().regex(/^[a-f0-9]{64}$/),renderer_version:z.string(),asset_hash:z.string().regex(/^[a-f0-9]{64}$/).nullable()}),
  status:z.enum(statuses),version:z.number().int().positive(),created_at:z.string().datetime().nullable(),
  reviewed_at:z.string().datetime().nullable(),reviewed_by:z.string().nullable(),published_at:z.string().datetime().nullable(),
  review_reason:z.string().nullable(),
}).strict();
export const manifestSchema=z.object({schema_version:z.literal(1),lesson_id:z.string(),activity_id:z.guid(),curriculum_version_id:z.number().int(),
  visuals:z.object(Object.fromEntries(slots.map(slot=>[slot,assetSchema]))).strict()}).strict();

export function validateManifest(manifest,lesson,{readFile}={}) {
  const errors=[];
  const parsed=manifestSchema.safeParse(manifest);
  if(!parsed.success)return parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`);
  if(manifest.lesson_id!==lesson.lesson_id||manifest.activity_id!==lesson.activity_id||manifest.curriculum_version_id!==lesson.version)errors.push('Invalid lesson/version mapping');
  const ids=new Set();
  for(const slot of slots){
    const a=manifest.visuals[slot];
    if(ids.has(a.id))errors.push('Duplicate asset ID'); ids.add(a.id);
    if(a.visual_type!==slot||a.lesson_id!==lesson.lesson_id||a.domain_id!==lesson.domain||a.activity_id!==lesson.activity_id||a.curriculum_version_id!==lesson.version)errors.push(`${slot}: invalid identity`);
    if(a.aspect_ratio!==`${a.width}:${a.height}`)errors.push(`${slot}: invalid aspect ratio`);
    const hasFile=['generated','needs_review','approved','published','retired'].includes(a.status);
    if(hasFile&&(!a.asset_path||!a.thumbnail_path||!a.provenance.asset_hash||!a.created_at))errors.push(`${slot}: missing artifact metadata`);
    if(['approved','published'].includes(a.status)&&(!a.reviewed_by||!a.reviewed_at||!a.review_reason))errors.push(`${slot}: human review missing`);
    if(a.status==='published'&&!a.published_at)errors.push(`${slot}: publication missing`);
    if(a.status!=='published'&&a.published_at&&a.status!=='retired')errors.push(`${slot}: invalid publication timestamp`);
    if(hasFile&&readFile)for(const path of [a.asset_path,a.thumbnail_path]){try{if(!readFile(path))errors.push(`${slot}: empty file`);}catch{errors.push(`${slot}: missing file ${path}`);}}
  }
  return errors;
}
