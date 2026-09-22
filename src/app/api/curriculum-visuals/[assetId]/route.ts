import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireContext } from "@/server/services/actor";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!z.guid().safeParse(assetId).success) return new Response("Visual unavailable", { status: 404 });
  const { supabase } = await requireContext();
  const { data, error } = await supabase.from("curriculum_visual_assets").select("metadata,status").eq("id", assetId).maybeSingle();
  if (error || !data) return new Response("Visual unavailable", { status: 404 });
  const metadata = data.metadata as { asset_path?: string; format?: string; provenance?: { asset_hash?: string } };
  if (!["html", "webp"].includes(metadata.format ?? "") || !metadata.asset_path?.startsWith("curriculum/assets/visuals/")) return new Response("Visual unavailable", { status: 404 });
  const root = resolve(process.cwd(), "curriculum/assets/visuals");
  const path = resolve(process.cwd(), metadata.asset_path);
  if (!path.startsWith(root + sep)) return new Response("Visual unavailable", { status: 404 });
  try {
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== metadata.provenance?.asset_hash) return new Response("Visual unavailable: artifact version mismatch", { status: 409 });
    return new Response(metadata.format === "html" ? bytes.toString("utf8") : new Uint8Array(bytes), { headers: {
      "Content-Type": metadata.format === "html" ? "text/html; charset=utf-8" : "image/webp",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    } });
  } catch { return new Response("Visual unavailable. The lesson's textual explanation remains available.", { status: 404 }); }
}
