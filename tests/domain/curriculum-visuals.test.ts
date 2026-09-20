import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildVisuals, hash, colors } from "../../curriculum/visuals/build.mjs";
import { buildCurriculum } from "../../curriculum/build.mjs";
import { slots, validateManifest } from "../../curriculum/visuals/schema.mjs";

const { manifests, coverage } = buildVisuals();
const { catalog } = buildCurriculum();
describe("canonical visual asset contract", () => {
  it("maps five slots for every lesson without treating pending assets as implemented", () => {
    expect(coverage).toMatchObject({ domains:11,lessons:112,target_slots:560,rendered:40,pending:520,approved:0,published:0 });
    const ids = manifests.flatMap(m => Object.values(m.visuals).map(a => a.id));
    expect(new Set(ids).size).toBe(560);
    for (const manifest of manifests) {
      expect(Object.keys(manifest.visuals)).toEqual(slots);
      const lesson = catalog.lessons.find(l => l.lesson_id === manifest.lesson_id)!;
      expect(validateManifest(manifest,lesson,{readFile:(path: string)=>readFileSync(path)})).toEqual([]);
      expect(z.guid().safeParse(lesson.activity_id).success).toBe(true);
      for (const asset of Object.values(manifest.visuals)) {
        if(asset.asset_path) expect(hash(readFileSync(asset.asset_path))).toBe(asset.provenance.asset_hash);
        else expect(asset.status).toBe("generation_pending");
        expect(asset.generation_prompt).not.toContain("correct_option");
      }
    }
  });
  it("rejects missing files, duplicate IDs, false publication, wrong versions and unsafe paths", () => {
    const original=manifests[0];
    const lesson=catalog.lessons[0];
    expect(validateManifest(original,lesson,{readFile:()=>{throw new Error("missing");}}).length).toBeGreaterThan(0);
    for (const mutate of [
      (m: typeof original)=>{m.visuals.concept.id=m.visuals.cover.id;},
      (m: typeof original)=>{m.visuals.cover.status="published";},
      (m: typeof original)=>{m.visuals.cover.curriculum_version_id=2;},
      (m: typeof original)=>{m.visuals.cover.asset_path="../../secrets";},
      (m: typeof original)=>{m.visuals.cover.alt_text="";},
      (m: typeof original)=>{m.visuals.cover.aspect_ratio="1:1";},
    ]) { const changed=structuredClone(original); mutate(changed); expect(validateManifest(changed,lesson).length).toBeGreaterThan(0); }
  });
  it("keeps every semantic text color above 4.5:1 on teaching surfaces", () => {
    const luminance=(hex: string)=>{
      const channels=hex.slice(1).match(/../g)!.map(c=>parseInt(c,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
      return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
    };
    for (const color of [colors.text,colors.muted,colors.proposal,colors.review,colors.verified,colors.warning,colors.denied,colors.evidence])
      for(const surface of [colors.background,colors.surface])expect((luminance(color)+0.05)/(luminance(surface)+0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
