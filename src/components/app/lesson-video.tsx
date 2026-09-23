"use client";
import { useState } from "react";
import type { CurriculumVideo, LessonVideoMapping } from "@/domain/curriculum/types";
import { assessLessonMedia } from "@/domain/curriculum/media-state";
import { TrackedVideo } from "./tracked-video";
import { curriculumPlaybackAction } from "@/server/actions/curriculum";

/**
 * Renders the lesson's video requirement in whichever state it is actually in.
 *
 * The state is decided by `assessLessonMedia`, the same module the release
 * console and the publication readiness check use, so what a learner sees and
 * what an operator is told can never disagree. There is no code path that
 * renders an empty or broken frame: every non-verified state renders intentional
 * copy instead of a player.
 */
export function LessonVideo({
  video,
  mapping,
  activityId,
  resumePosition,
}: {
  video: CurriculumVideo | null;
  mapping: LessonVideoMapping | null;
  activityId?: string;
  resumePosition?: number;
}) {
  const [failed, setFailed] = useState(false);
  const media = assessLessonMedia(mapping, video);

  // Everything except a verified asset is explained in words, never as a frame
  // that may or may not load.
  if (media.state !== "verified" || !video) {
    return (
      <section aria-label="Lesson video" className="space-y-3">
        <p
          role="status"
          data-testid="lesson-video-state"
          data-media-state={media.state}
          className="rounded-xl border border-line p-4 text-sm text-ink"
        >
          {media.learnerMessage}
        </p>
        {video ? (
          <a
            href={video.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded text-sm text-brand underline focus-visible:outline-2"
          >
            Open Original Video
          </a>
        ) : null}
      </section>
    );
  }

  const parameters = new URLSearchParams();
  if (mapping?.start_seconds != null) parameters.set("start", String(mapping.start_seconds));
  if (mapping?.end_seconds != null) parameters.set("end", String(mapping.end_seconds));
  const source = `${video.embed_url}${parameters.size ? `?${parameters}` : ""}`;

  return (
    <section aria-label="Lesson video" className="space-y-3" data-testid="lesson-video-state" data-media-state={media.state}>
      {activityId && !failed ? (
        <TrackedVideo
          activityId={activityId}
          videoId={video.video_id}
          start={resumePosition ?? mapping?.start_seconds ?? 0}
          end={mapping?.end_seconds ?? null}
          title={video.candidate_title}
        />
      ) : failed ? (
        <p role="status" className="rounded-xl border border-line p-4 text-sm text-ink">
          The embedded player could not load. Use Open Original Video below; the written lesson continues underneath.
        </p>
      ) : (
        <iframe
          src={source}
          title={video.candidate_title}
          className="aspect-video w-full rounded-xl border border-line"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFailed(true)}
        />
      )}
      <a
        href={video.source_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          if (activityId) void curriculumPlaybackAction({ kind: "resource_opened", activityId });
        }}
        className="inline-block rounded text-sm text-brand underline focus-visible:outline-2"
      >
        Open Original Video
      </a>
      <p className="text-xs text-ink-subtle">
        If the player reports an error, use the original source. Opening or viewing a video does not award completion or mastery.
      </p>
      {video.transcript ? (
        <details>
          <summary className="cursor-pointer text-sm text-ink">Transcript</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{video.transcript}</p>
        </details>
      ) : null}
    </section>
  );
}
