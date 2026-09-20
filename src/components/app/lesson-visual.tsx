"use client";
import { useState } from "react";
export interface LessonVisualRow {
  id: string;
  visual_type: string;
  status: string;
  metadata: { title: string; caption: string; alt_text: string; extended_description: string; asset_path: string | null; format: string; width: number; height: number };
}
export function LessonVisual({ asset, equivalent, slot }: { asset?: LessonVisualRow; equivalent: string; slot: string }) {
  const [failed, setFailed] = useState(false);
  const available = asset?.status === "published" && asset.metadata.asset_path && !failed;
  return <figure className="my-4 space-y-2 rounded-xl border border-line p-4" aria-label={`${slot} visual`}>
    {available && asset.metadata.format === "webp" ?
      // eslint-disable-next-line @next/next/no-img-element -- Authenticated, hash-checked asset route; do not proxy private bytes through a public image optimizer.
      <img src={`/api/curriculum-visuals/${asset.id}`} alt={asset.metadata.alt_text} width={asset.metadata.width} height={asset.metadata.height} loading={slot === "cover" ? "eager" : "lazy"} className="h-auto w-full rounded-lg" onError={() => setFailed(true)} /> :
      available ? <iframe src={`/api/curriculum-visuals/${asset.id}`} title={asset.metadata.title} sandbox="" loading={slot === "cover" ? "eager" : "lazy"}
      className="h-[36rem] w-full rounded-lg border-0" onError={() => setFailed(true)} /> :
      <p className="text-sm text-ink-muted">Visual unavailable. The textual explanation is available below.</p>}
    {available ? <figcaption className="text-sm text-ink-muted">{asset.metadata.caption}</figcaption> : null}
    <details><summary className="cursor-pointer">Text equivalent</summary><p className="mt-2 whitespace-pre-wrap text-sm">{available ? asset.metadata.extended_description : equivalent}</p></details>
  </figure>;
}
