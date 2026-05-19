#!/usr/bin/env node
/**
 * Transfer alle profiel-data + media naar een ANDER Supabase project.
 *
 * Wat het kopieert:
 *   - public.profiles                (alle kolommen)
 *   - public.profile_media           (alle rijen, met herschreven URLs)
 *   - Storage bucket `profile-media` (alle objecten, 1-op-1 paden)
 *
 * Wat het NIET kopieert:
 *   - users, conversations, messages, credit_ledger, stripe_checkouts, etc.
 *     (alleen profielcontent; dat is meestal wat je wil overdragen)
 *
 * Idempotent: rows worden geüpserted op `id`. Storage objecten worden ge-upload
 * met `upsert: true`. Reruns zijn dus veilig.
 *
 * VOORWAARDEN OP HET DOELPROJECT:
 *   1. Run eerst `supabase/schema.sql` zodat de `profiles` + `profile_media`
 *      tabellen bestaan.
 *   2. Run `supabase/setup-profile-media-storage.sql` zodat de publieke bucket
 *      `profile-media` met de juiste policies klaar staat.
 *
 * Vereiste env vars (kunnen ook in `.env.transfer` staan):
 *   SOURCE_SUPABASE_URL                = bestaande project URL
 *   SOURCE_SUPABASE_SERVICE_ROLE_KEY   = service_role key van het bron-project
 *   TARGET_SUPABASE_URL                = nieuw project URL
 *   TARGET_SUPABASE_SERVICE_ROLE_KEY   = service_role key van het doel-project
 *
 * Gebruik:
 *   # dry-run (default — laat zien wat het zou doen, schrijft niets)
 *   node scripts/transfer-profiles-to-supabase.mjs
 *
 *   # echte transfer
 *   node scripts/transfer-profiles-to-supabase.mjs --apply
 *
 *   # alleen DB rows, sla storage objects over
 *   node scripts/transfer-profiles-to-supabase.mjs --apply --skip-storage
 *
 *   # alleen storage, sla DB rows over
 *   node scripts/transfer-profiles-to-supabase.mjs --apply --skip-db
 *
 *   # beperk tot N profielen (handig voor testen)
 *   node scripts/transfer-profiles-to-supabase.mjs --apply --limit=5
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has("--apply");
const SKIP_STORAGE = ARGS.has("--skip-storage");
const SKIP_DB = ARGS.has("--skip-db");
const LIMIT = (() => {
  const arg = [...ARGS].find((a) => a.startsWith("--limit="));
  if (!arg) return null;
  const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const BUCKET = "profile-media";

// ── env loader ───────────────────────────────────────────────────────────────
function loadEnvFile(filename) {
  const file = path.join(ROOT, filename);
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(".env.transfer");
loadEnvFile(".env.local");

const SOURCE_URL =
  process.env.SOURCE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SOURCE_KEY =
  process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_URL = process.env.TARGET_SUPABASE_URL;
const TARGET_KEY = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;

function missing(name, value) {
  if (!value) {
    console.error(`Ontbrekende env var: ${name}`);
    return true;
  }
  return false;
}
let bad = false;
bad = missing("SOURCE_SUPABASE_URL", SOURCE_URL) || bad;
bad = missing("SOURCE_SUPABASE_SERVICE_ROLE_KEY", SOURCE_KEY) || bad;
bad = missing("TARGET_SUPABASE_URL", TARGET_URL) || bad;
bad = missing("TARGET_SUPABASE_SERVICE_ROLE_KEY", TARGET_KEY) || bad;
if (bad) {
  console.error(
    "\nLeg deze 4 waarden in `.env.transfer` of zet ze als shell env vars en herstart het script.\n"
  );
  process.exit(1);
}

if (SOURCE_URL === TARGET_URL) {
  console.error("SOURCE en TARGET URLs zijn identiek — refusing to copy onto self.");
  process.exit(1);
}

const source = createClient(SOURCE_URL, SOURCE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(TARGET_URL, TARGET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── helpers ──────────────────────────────────────────────────────────────────
function sourceStorageHostPrefix() {
  // bv. "https://abc.supabase.co/storage/v1/object/public/profile-media/"
  return `${SOURCE_URL.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/`;
}
function targetStorageHostPrefix() {
  return `${TARGET_URL.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/`;
}

/** URLs die naar de SOURCE bucket wijzen → herschrijf naar TARGET bucket. */
function rewriteUrl(url) {
  if (typeof url !== "string" || !url) return url;
  const srcPrefix = sourceStorageHostPrefix();
  if (url.startsWith(srcPrefix)) {
    return targetStorageHostPrefix() + url.slice(srcPrefix.length);
  }
  return url;
}

function rewritePhotoUrlsJson(value) {
  if (!Array.isArray(value)) return value;
  return value.map((u) => (typeof u === "string" ? rewriteUrl(u) : u));
}

// ── 1. profiles transfer ─────────────────────────────────────────────────────
async function transferProfiles() {
  console.log("\n[profiles] ophalen vanaf source…");
  let query = source.from("profiles").select("*").order("created_at", { ascending: true });
  if (LIMIT) query = query.limit(LIMIT);
  const { data: rows, error } = await query;
  if (error) throw new Error(`source profiles fetch: ${error.message}`);
  console.log(`[profiles] ${rows.length} rijen gevonden`);

  const prepared = rows.map((r) => ({
    ...r,
    avatar_url: rewriteUrl(r.avatar_url),
    photo_urls: rewritePhotoUrlsJson(r.photo_urls),
  }));

  if (!APPLY) {
    console.log(`[profiles] DRY-RUN — zou ${prepared.length} rijen upserten in target.profiles`);
    return { count: prepared.length, sample: prepared[0] };
  }

  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const slice = prepared.slice(i, i + CHUNK);
    const { error: upErr } = await target.from("profiles").upsert(slice, { onConflict: "id" });
    if (upErr) throw new Error(`target profiles upsert: ${upErr.message}`);
    written += slice.length;
    console.log(`[profiles] geüpserted ${written}/${prepared.length}`);
  }
  return { count: written };
}

// ── 2. profile_media transfer ────────────────────────────────────────────────
async function transferProfileMedia() {
  console.log("\n[profile_media] ophalen vanaf source…");
  let query = source
    .from("profile_media")
    .select("*")
    .order("profile_id", { ascending: true })
    .order("sort_order", { ascending: true });
  const { data: rows, error } = await query;
  if (error) throw new Error(`source profile_media fetch: ${error.message}`);

  const filtered = LIMIT
    ? (() => {
        const allowed = new Set();
        const out = [];
        for (const r of rows) {
          if (allowed.size >= LIMIT && !allowed.has(r.profile_id)) continue;
          allowed.add(r.profile_id);
          out.push(r);
        }
        return out;
      })()
    : rows;

  console.log(`[profile_media] ${filtered.length} rijen geselecteerd`);

  const prepared = filtered.map((r) => ({ ...r, url: rewriteUrl(r.url) }));

  if (!APPLY) {
    console.log(`[profile_media] DRY-RUN — zou ${prepared.length} rijen upserten in target.profile_media`);
    return { count: prepared.length };
  }

  const CHUNK = 250;
  let written = 0;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const slice = prepared.slice(i, i + CHUNK);
    const { error: upErr } = await target.from("profile_media").upsert(slice, { onConflict: "id" });
    if (upErr) throw new Error(`target profile_media upsert: ${upErr.message}`);
    written += slice.length;
    console.log(`[profile_media] geüpserted ${written}/${prepared.length}`);
  }
  return { count: written };
}

// ── 3. Storage objects copy ─────────────────────────────────────────────────
async function listAllStorageObjects(client, bucket) {
  const all = [];
  const stack = [""];
  while (stack.length > 0) {
    const prefix = stack.pop();
    let offset = 0;
    // Supabase Storage list paginated; gebruik limit 1000
    while (true) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`storage list ${prefix}: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const obj of data) {
        const fullPath = prefix ? `${prefix}/${obj.name}` : obj.name;
        if (obj.id === null && obj.metadata === null) {
          // map (folder)
          stack.push(fullPath);
        } else {
          all.push({ path: fullPath, metadata: obj.metadata, name: obj.name });
        }
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  }
  return all;
}

async function transferStorageObjects(allowedProfileIds) {
  console.log("\n[storage] inventariseren source bucket…");
  const objects = await listAllStorageObjects(source, BUCKET);
  console.log(`[storage] ${objects.length} objecten gevonden in source.${BUCKET}`);

  const filtered = allowedProfileIds
    ? objects.filter((o) => {
        // path begint typisch met `<profileId>/...` of `profiles/<profileId>/...`
        const segs = o.path.split("/");
        return segs.some((s) => allowedProfileIds.has(s));
      })
    : objects;

  if (allowedProfileIds) {
    console.log(`[storage] ${filtered.length} objecten matchen de --limit profielen`);
  }

  if (!APPLY) {
    console.log(`[storage] DRY-RUN — zou ${filtered.length} objecten kopiëren naar target.${BUCKET}`);
    return { count: filtered.length };
  }

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const obj of filtered) {
    try {
      const { data: blob, error: dlErr } = await source.storage.from(BUCKET).download(obj.path);
      if (dlErr || !blob) {
        failed += 1;
        console.warn(`[storage] download faalde voor ${obj.path}: ${dlErr?.message || "geen blob"}`);
        continue;
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      const contentType = obj.metadata?.mimetype || blob.type || "application/octet-stream";
      const { error: upErr } = await target.storage.from(BUCKET).upload(obj.path, buffer, {
        contentType,
        upsert: true,
      });
      if (upErr) {
        failed += 1;
        console.warn(`[storage] upload faalde voor ${obj.path}: ${upErr.message}`);
        continue;
      }
      copied += 1;
      if (copied % 25 === 0 || copied === filtered.length) {
        console.log(`[storage] ${copied}/${filtered.length} gekopieerd (failed=${failed})`);
      }
    } catch (e) {
      failed += 1;
      console.warn(`[storage] uncaught error ${obj.path}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`[storage] klaar — copied=${copied} skipped=${skipped} failed=${failed}`);
  return { count: copied, failed };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Transfer profielen + media naar ander Supabase project");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  source : ${SOURCE_URL}`);
  console.log(`  target : ${TARGET_URL}`);
  console.log(`  apply  : ${APPLY ? "JA (echte writes)" : "NEE (dry-run)"}`);
  console.log(`  limit  : ${LIMIT ?? "geen (alle profielen)"}`);
  console.log(`  skip   : db=${SKIP_DB}  storage=${SKIP_STORAGE}`);
  console.log("───────────────────────────────────────────────────────────────");

  let allowedIds = null;
  if (LIMIT && !SKIP_DB) {
    const { data: limitRows, error } = await source
      .from("profiles")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(LIMIT);
    if (error) throw new Error(`source profiles id-list: ${error.message}`);
    allowedIds = new Set((limitRows ?? []).map((r) => r.id));
  }

  let profilesResult = null;
  let mediaResult = null;
  let storageResult = null;

  if (!SKIP_DB) {
    profilesResult = await transferProfiles();
    mediaResult = await transferProfileMedia();
  } else {
    console.log("\n[db] overgeslagen (--skip-db)");
  }

  if (!SKIP_STORAGE) {
    storageResult = await transferStorageObjects(allowedIds);
  } else {
    console.log("\n[storage] overgeslagen (--skip-storage)");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("Samenvatting");
  console.log("═══════════════════════════════════════════════════════════════");
  if (profilesResult) console.log(`  profiles      : ${profilesResult.count}`);
  if (mediaResult) console.log(`  profile_media : ${mediaResult.count}`);
  if (storageResult) console.log(`  storage files : ${storageResult.count} (failed=${storageResult.failed ?? 0})`);
  if (!APPLY) {
    console.log("\nDit was een DRY-RUN. Voeg `--apply` toe om echt te schrijven.");
  }
}

main().catch((e) => {
  console.error("\nTransfer mislukt:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
