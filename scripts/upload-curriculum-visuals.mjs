#!/usr/bin/env node
/**
 * Uploads curriculum visual artifacts into Supabase Storage and records the
 * object key against each asset row.
 *
 * This is an operator action, not part of the build: it needs a service-role
 * key, which exists only in an operator's shell and never in the browser or in
 * a `NEXT_PUBLIC_*` variable. Run it once per release, after
 * `npm run visuals:build` and before publishing visuals for review.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-curriculum-visuals.mjs [--dry-run]
 *
 * It is idempotent: an object whose stored bytes already hash to the asset's
 * recorded provenance hash is left alone. It never edits `metadata`, which is
 * immutable once reviewed, and it never changes an asset's status — publication
 * remains a reviewer's decision through `review_curriculum_visual`.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "curriculum-visuals";
const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = resolve(import.meta.dirname, "..");

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. The service-role key is server-only.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const CONTENT_TYPE = { webp: "image/webp", html: "text/html; charset=utf-8" };

const { data: assets, error } = await supabase
  .from("curriculum_visual_assets")
  .select("id,activity_id,visual_type,status,metadata,storage_object_path");
if (error) {
  console.error(`Could not read visual assets: ${error.message}`);
  process.exit(1);
}

let uploaded = 0;
let skipped = 0;
let missing = 0;
let mismatched = 0;

for (const asset of assets ?? []) {
  // Rejected assets are historical review records. Their bytes must not be
  // uploaded or treated as a release-blocking provenance mismatch.
  if (asset.status === "rejected") {
    skipped += 1;
    continue;
  }
  const assetPath = asset.metadata?.asset_path;
  const format = asset.metadata?.format;
  const expectedHash = asset.metadata?.provenance?.asset_hash;

  // Only artifacts that were actually generated can be uploaded.
  if (!assetPath || !CONTENT_TYPE[format]) {
    skipped += 1;
    continue;
  }

  let bytes;
  try {
    bytes = await readFile(resolve(ROOT, assetPath));
  } catch {
    console.warn(`missing artifact: ${asset.visual_type} ${asset.id} (${assetPath})`);
    missing += 1;
    continue;
  }

  // The hash recorded at generation is the contract. Uploading bytes that do
  // not match it would put unreviewed content behind a reviewed record.
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash && actualHash !== expectedHash) {
    console.warn(`hash mismatch, not uploading: ${asset.id} (expected ${expectedHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…)`);
    mismatched += 1;
    continue;
  }

  const objectPath = `${asset.activity_id}/${asset.visual_type}/${actualHash}.${format}`;
  if (asset.storage_object_path === objectPath) {
    skipped += 1;
    continue;
  }

  if (DRY_RUN) {
    console.log(`would upload ${objectPath} (${bytes.length} bytes)`);
    uploaded += 1;
    continue;
  }

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, bytes, { contentType: CONTENT_TYPE[format], upsert: true });
  if (upload.error) {
    console.error(`upload failed for ${asset.id}: ${upload.error.message}`);
    continue;
  }

  const update = await supabase
    .from("curriculum_visual_assets")
    .update({ storage_bucket: BUCKET, storage_object_path: objectPath })
    .eq("id", asset.id);
  if (update.error) {
    console.error(`could not record object path for ${asset.id}: ${update.error.message}`);
    continue;
  }
  uploaded += 1;
}

console.log(
  JSON.stringify(
    { bucket: BUCKET, dry_run: DRY_RUN, uploaded, skipped, missing_artifact: missing, hash_mismatch: mismatched, total: assets?.length ?? 0 },
    null,
    2,
  ),
);
if (mismatched > 0) process.exit(1);
