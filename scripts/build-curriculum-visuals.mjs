import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { buildVisuals } from '../curriculum/visuals/build.mjs';
import { manifestSchema } from '../curriculum/visuals/schema.mjs';
const check=process.argv.includes('--check');
const {manifests,files,coverage}=buildVisuals();
const json=value=>JSON.stringify(value,null,2)+'\n';
files.set('curriculum/visuals/manifest.schema.json',json(z.toJSONSchema(manifestSchema)));
files.set('curriculum/visuals/coverage.json',json(coverage));
for(const manifest of manifests)files.set(`curriculum/assets/visuals/${manifest.lesson_id.slice(0,2)}/${manifest.lesson_id}/manifest.v1.json`,json(manifest));
files.set('curriculum/visuals/index.json',json(manifests.map(m=>({lesson_id:m.lesson_id,manifest_path:`curriculum/assets/visuals/${m.lesson_id.slice(0,2)}/${m.lesson_id}/manifest.v1.json`}))));
const quote=value=>`'${String(value).replaceAll("'","''")}'`;
files.set('supabase/migrations/20260921190011_curriculum_visual_seed.sql',
  '-- Immutable visual v1 import: pending mappings are not completed assets.\n'+buildVisuals({rasterCovers:false}).manifests.flatMap(m=>Object.values(m.visuals)).map(a=>
    `insert into public.curriculum_visual_assets(id,activity_id,visual_type,version,status,metadata) values (${quote(a.id)},${quote(a.activity_id)},${quote(a.visual_type)},${a.version},${quote(a.status)},${quote(JSON.stringify(a))}::jsonb) on conflict(activity_id,visual_type,version) do nothing;`).join('\n')+'\n');
const replacementCovers=manifests.map(m=>m.visuals.cover).filter(a=>a.version>1);
files.set('supabase/migrations/20260921190012_reference_cover_assets.sql','-- Replace unapproved diagram covers with true cover artwork. Preserve old versions.\n'+replacementCovers.map(a=>
 `update public.curriculum_visual_assets set status='rejected',review_reason='Replaced: a concept panel does not satisfy the editorial cover contract.' where activity_id=${quote(a.activity_id)} and visual_type='cover' and version=1 and status='needs_review';\ninsert into public.curriculum_visual_assets(id,activity_id,visual_type,version,status,metadata) values (${quote(a.id)},${quote(a.activity_id)},'cover',${a.version},${quote(a.status)},${quote(JSON.stringify(a))}::jsonb) on conflict(activity_id,visual_type,version) do nothing;`).join('\n')+'\n');
for(const [path,content] of files){
  if(check){let actual;try{actual=readFileSync(path,'utf8').replaceAll('\r\n','\n');}catch{throw new Error(`Missing visual artifact: ${path}`);}if(actual!==content)throw new Error(`Visual artifact drift: ${path}`);}
  else {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);}
}
console.log(JSON.stringify({mode:check?'verified':'written',...coverage},null,2));
