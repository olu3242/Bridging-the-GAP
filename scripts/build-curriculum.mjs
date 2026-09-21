import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCurriculum, buildSeed, buildRuntimeSeed, validateCurriculum } from '../curriculum/build.mjs';
import { engineContract } from '../curriculum/source/engine.mjs';

const {catalog,answerKeys}=buildCurriculum();
const report=validateCurriculum(catalog,answerKeys);
if(!report.valid)throw new Error(report.errors.join('\n'));
const json=(data)=>JSON.stringify(data,null,2)+'\n';
const files={
  'curriculum/generated/catalog.v1.json':json(catalog),
  'curriculum/generated/protected-assessments.v1.json':json(answerKeys),
  'curriculum/generated/engine-contract.v1.json':json(engineContract),
  'curriculum/generated/coverage.v1.json':json(report),
  'supabase/seeds/curriculum-v1.sql':buildSeed(catalog),
  'supabase/migrations/20260921190003_curriculum_contract_seed.sql':buildRuntimeSeed(catalog,answerKeys),
};
const check=process.argv.includes('--check');
for(const [name,contents] of Object.entries(files)){
  const path=resolve(name);
  if(check){if(readFileSync(path,'utf8').replaceAll('\r\n','\n')!==contents)throw new Error(`Generated artifact is stale: ${name}`);}
  else {mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,contents);}
}
console.log(JSON.stringify({mode:check?'verified':'generated',...report.coverage},null,2));
