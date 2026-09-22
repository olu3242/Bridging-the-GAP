"use client";
import { useState } from "react";
import type { CurriculumVideo, LessonVideoMapping } from "@/domain/curriculum/types";
import { TrackedVideo } from "./tracked-video";
import { curriculumPlaybackAction } from "@/server/actions/curriculum";

export function LessonVideo({ video, mapping, activityId, resumePosition }: { video: CurriculumVideo | null; mapping: LessonVideoMapping | null; activityId?: string; resumePosition?: number }) {
  const [failed, setFailed] = useState(false);
  if (!video) return <p className="rounded-xl border border-white/10 p-4 text-sm text-ink-muted">
    {mapping?.required ? "Video pending. A verified source must be attached before this lesson can be published." : "This project does not require a video. Follow the project instructions and submit your evidence."}
  </p>;
  const parameters = new URLSearchParams();
  if (mapping?.start_seconds != null) parameters.set("start", String(mapping.start_seconds));
  if (mapping?.end_seconds != null) parameters.set("end", String(mapping.end_seconds));
  const source = `${video.embed_url}${parameters.size ? `?${parameters}` : ""}`;
  return <section aria-label="Lesson video" className="space-y-3">
    {video.health_status !== "healthy" || !mapping?.relevance_verified_at ? <p role="status" className="text-sm text-ink-muted">Video pending verification. This preview does not count as verified playback or completion.</p> : null}
    {activityId && video.health_status === "healthy" && mapping?.relevance_verified_at ?
      <TrackedVideo activityId={activityId} videoId={video.video_id} start={resumePosition ?? mapping.start_seconds ?? 0} end={mapping.end_seconds} title={video.candidate_title} /> :
      failed || video.health_status === "unavailable" ? <p role="status">The embedded video is unavailable. Your lesson content remains available below.</p> :
      <iframe src={source} title={video.candidate_title} className="aspect-video w-full rounded-xl border border-white/10"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed(true)} />}
    <a href={video.source_url} target="_blank" rel="noopener noreferrer" onClick={() => { if (activityId) void curriculumPlaybackAction({ kind: "resource_opened", activityId }); }} className="inline-block rounded text-sm text-brand underline focus-visible:outline-2">Open Original Video</a>
    <p className="text-xs text-ink-subtle">If the player reports an error, use the original source. Opening or viewing a video does not award completion or mastery.</p>
    {video.transcript ? <details><summary>Transcript</summary><p className="whitespace-pre-wrap text-sm">{video.transcript}</p></details> : null}
  </section>;
}
