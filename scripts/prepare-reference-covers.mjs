import sharp from 'sharp';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const descriptions={
 AF01:'A capacity gate, pattern-sorting tray and a person considering a card represent fixed rules, learned patterns and human judgment.',
 PC07:'A selection aperture isolates two relevant source pages while unrelated material stays outside the context boundary.',
 AA07:'A person holds an approval gate around a narrow proposal while a wider changed proposal waits outside its scope.',
 SE10:'Learner and course tabs fit together in one record drawer, representing related data protected by a unique enrollment constraint.',
 DA08:'A straightedge aligns two symbolic columns to a shared baseline, emphasizing honest comparison rather than exaggerated differences.',
 CS03:'Distinct identity tabs match only their own document sleeves, representing record ownership rather than blanket access.',
 EI06:'A learner tests a small manual room-booking board before investing in automation, with an observation notebook nearby.',
 VC10:'A persistent record remains inside a refresh ring while a separate access boundary represents testing another user’s permissions.',
};
const records={};
for(const [id,alt] of Object.entries(descriptions)){
 const base=`curriculum/assets/visuals/${id.slice(0,2)}/${id}/cover`;
 const source=`${base}/source/${id}-cover-master-v1.png`;
 const output=`${base}/generated/${id}-cover-v2.webp`;
 const thumb=`${base}/generated/${id}-cover-thumbnail-v2.webp`;
 mkdirSync(`${base}/generated`,{recursive:true});
 await sharp(source).resize(1600,900,{fit:'contain',background:'#141724'}).webp({quality:85}).toFile(output);
 await sharp(output).resize(480,270).webp({quality:82}).toFile(thumb);
 // Responsive derivatives preserve all meaningful source details; no unrelated art.
 for(const [label,width,height] of [['portrait',720,900],['square',640,640],['small',800,450]])
   await sharp(output).resize(width,height,{fit:'contain',background:'#141724'}).webp({quality:82}).toFile(`${base}/generated/${id}-cover-${label}-v2.webp`);
 records[id]={asset_path:output,thumbnail_path:thumb,source_path:source,alt_text:alt,
   source_hash:createHash('sha256').update(readFileSync(source)).digest('hex'),asset_hash:createHash('sha256').update(readFileSync(output)).digest('hex'),
   generation_prompt:readFileSync(`${base}/source/${id}-cover-prompt-v1.txt`,'utf8').trim(),
   generation_provider:'builtin_image_gen',generation_model:null,
   responsive_variants:['portrait','square','small'].map(label=>`${base}/generated/${id}-cover-${label}-v2.webp`)};
}
writeFileSync('curriculum/visuals/reference-covers.json',JSON.stringify(records,null,2)+'\n');
console.log(`Prepared ${Object.keys(records).length} reference covers; none approved.`);
