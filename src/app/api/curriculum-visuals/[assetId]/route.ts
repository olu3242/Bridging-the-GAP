import { createHash } from "node:crypto";
import { z } from "zod";
import { requireContext } from "@/server/services/actor";

/**
 * Serves a curriculum visual's bytes from object storage.
 *
 * Three properties are preserved from the previous filesystem implementation
 * and are the reason this route exists at all rather than a public URL:
 *
 *  - **Authentication.** The caller's own session fetches the object, so storage
 *    RLS decides access. A learner reaches published visuals only.
 *  - **Integrity.** Bytes are hashed and compared against the provenance hash
 *    recorded at review time. Content that does not match what was reviewed is
 *    refused with 409 rather than served.
 *  - **Containment.** The response is sandboxed with a restrictive CSP and is
 *    never cached by a shared cache.
 *
 * What changed is only where the bytes come from: Supabase Storage rather than
 * the deployment's filesystem, which is not a durable asset store.
 */

const BUCKET = "curriculum-visuals";
const SERVED_FORMATS = new Set(["html", "webp"]);

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  if (!z.guid().safeParse(assetId).success) return new Response("Visual unavailable", { status: 404 });

  const { supabase } = await requireContext();
  const { data, error } = await supabase
    .from("curriculum_visual_assets")
    .select("metadata,status,storage_bucket,storage_object_path")
    .eq("id", assetId)
    .maybeSingle();
  if (error || !data) return new Response("Visual unavailable", { status: 404 });

  const metadata = data.metadata as { format?: string; provenance?: { asset_hash?: string } };
  const objectPath = data.storage_object_path as string | null;
  if (!SERVED_FORMATS.has(metadata.format ?? "") || !objectPath) {
    return new Response("Visual unavailable. The lesson's textual explanation remains available.", { status: 404 });
  }

  const download = await supabase.storage.from((data.storage_bucket as string) ?? BUCKET).download(objectPath);
  if (download.error || !download.data) {
    return new Response("Visual unavailable. The lesson's textual explanation remains available.", { status: 404 });
  }

  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== metadata.provenance?.asset_hash) {
    // The stored object is not what was reviewed. Refusing is the only safe
    // answer: serving it would put unreviewed content behind a reviewed record.
    return new Response("Visual unavailable: artifact version mismatch", { status: 409 });
  }

  return new Response(metadata.format === "html" ? bytes.toString("utf8") : new Uint8Array(bytes), {
    headers: {
      "Content-Type": metadata.format === "html" ? "text/html; charset=utf-8" : "image/webp",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
