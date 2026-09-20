"use client";
import { useEffect, useRef, useState } from "react";
import { curriculumPlaybackAction } from "@/server/actions/curriculum";

interface Player { getCurrentTime(): number; getPlayerState(): number; destroy(): void }
interface YouTubeAPI { Player: new (element: HTMLElement, options: Record<string, unknown>) => Player }
declare global { interface Window { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void } }
let apiReady: Promise<YouTubeAPI> | undefined;
function loadPlayer() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return apiReady ??= new Promise<YouTubeAPI>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); if (window.YT) resolve(window.YT); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { apiReady = undefined; reject(new Error("Video player unavailable")); };
    document.head.appendChild(script);
  });
}

export function TrackedVideo({ activityId, videoId, start, end, title }: {
  activityId: string; videoId: string; start: number; end: number | null; title: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("Playback progress is saved while the video plays.");
  useEffect(() => {
    let disposed = false;
    let player: Player | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let previous: number | null = null;
    let busy = false;
    let sampledAt = 0;
    const tick = async () => {
      if (disposed || busy || !player) return;
      if (player.getPlayerState() !== 1 || document.visibilityState !== "visible") { previous = null; return; }
      const current = player.getCurrentTime();
      const now = performance.now();
      // Seeks, fast playback and background gaps start a fresh interval, without credit.
      const restart = previous === null || current < previous || current - previous > 12 ||
        current - previous > (now - sampledAt) / 1000 + 0.1;
      busy = true;
      try {
        const result = restart ? await curriculumPlaybackAction({ kind: "begin", activityId, position: current }) :
          current - previous! >= 1 ? await curriculumPlaybackAction({ kind: "interval", activityId, requestId: crypto.randomUUID(), from: previous, to: current }) : null;
        if (disposed) return;
        if (result?.status === "error") { previous = null; setMessage(result.message ?? "Progress could not be saved."); }
        else if (result) { previous = current; sampledAt = now; setMessage("Playback progress saved. Reloading preserves recorded progress."); }
      } catch { previous = null; if (!disposed) setMessage("Progress could not be saved. Playback will retry."); }
      finally { busy = false; }
    };
    loadPlayer().then(api => {
      if (disposed || !host.current) return;
      const element = document.createElement("div");
      host.current.appendChild(element);
      player = new api.Player(element, {
        videoId, width: "100%", height: "360",
        playerVars: { origin: window.location.origin, start: Math.floor(start), ...(end == null ? {} : { end }), playsinline: 1 },
        events: {
          onReady: () => { timer = setInterval(() => { void tick(); }, 2000); },
          onStateChange: () => { void tick(); },
          onError: () => { previous = null; setMessage("The embedded video is unavailable. Use Open Original Video; no playback credit is awarded for opening the link."); },
        },
      });
    }).catch(() => { if (!disposed) setMessage("The embedded player could not load. Use Open Original Video."); });
    return () => { disposed = true; if (timer) clearInterval(timer); player?.destroy(); };
  }, [activityId, videoId, start, end]);
  return <div><div ref={host} aria-label={title} className="overflow-hidden rounded-xl" /><p role="status" className="mt-2 text-sm text-ink-muted">{message}</p></div>;
}

export function LessonViewed({ activityId }: { activityId: string }) {
  useEffect(() => { void curriculumPlaybackAction({ kind: "viewed", activityId }); }, [activityId]);
  return null;
}
