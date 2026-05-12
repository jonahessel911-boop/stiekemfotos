#!/usr/bin/env node
/**
 * Backfill: zet bestaande `profile_media.url` records die nog `/api/conversations/...`
 * paden bevatten om naar publieke Supabase Storage URLs. Werkt ook voor legacy
 * Vercel Blob URLs (die mogen blijven werken, maar we migreren ze naar één
 * canonieke Supabase Storage bucket zodat alle assets op één plek staan).
 *
 * Dit script kan twee soorten bronnen verwerken:
 *   a) Legacy proxy URL `/api/conversations/<convId>/image/<msgId>` →
 *      leest het lokale bestand uit `data/conv-images/<convId>/<msgId>.{jpg,jpeg,png}`
 *      en upload het naar Supabase Storage `profile-media`.
 *   b) Vercel Blob URLs (`https://*.public.blob.vercel-storage.com/...`) → downloadt
 *      het bestand HTTP, upload naar Supabase Storage, en update de DB.
 *
 * Vereist .env.local of process env:
 *   SUPABASE_URL (of NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optioneel:
 *   BLOB_READ_WRITE_TOKEN — niet meer nodig om te lezen van Vercel Blob (publieke
 *   URLs zijn open), maar wel als je private blobs migreert.
 *
 * Gebruik:
 *   # dry-run (default)
 *   node scripts/migrate-local-profile-media-to-supabase.mjs
 *
 *   # echte writes naar DB + Storage
 *   node scripts/migrate-local-profile-media-to-supabase.mjs --apply
 *
 *   # alleen lokale-fs sources doen, sla Vercel Blob bron over
 *   node scripts/migrate-local-profile-media-to-supabase.mjs --apply --skip-remote
 *
 * Het script is idempotent: rows waarvan de URL al naar Supabase Storage wijst
 * worden overgeslagen. Reruns zijn veilig.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const ARGS = new Set(process.argv.slice(2));
const APPLY = ARGS.has("--apply");
const SKIP_REMOTE = ARGS.has("--skip-remote");
const BUCKET = "profile-media";

// ─────────────────────────────────────────────────────────────────────────────
// .env.local loader (geen dotenv-dep)
// ─────────────────────────────────────────────────────────────────────────────
function parseDotenvLocal(raw) {
  const out = new Map();
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1).replace(/\\n/g, "\n");
    }
    out.set(key, val);
  }
  return out;
}

function loadEnvFromDotenvLocal() {
  if (!fs.existsSync(ENV_FILE)) return;
  const vars = parseDotenvLocal(fs.readFileSync(ENV_FILE, "utf8"));
  for (const [k, v] of vars.entries()) {
    if (!process.env[k] && v) process.env[k] = v;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function legacyProxyParts(url) {
  const m = /^\/api\/conversations\/([^/]+)\/image\/([^/?#]+)$/.exec((url ?? "").trim());
  if (!m) return null;
  return { conversationId: m[1], messageId: m[2] };
}

function isAlreadySupabaseStorageUrl(url, supabaseHost) {
  if (!url || !supabaseHost) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === supabaseHost &&
      u.pathname.includes("/storage/v1/object/public/" + BUCKET + "/")
    );
  } catch {
    return false;
  }
}

function isRemoteUrl(url) {
  return /^https?:\/\//i.test((url ?? "").trim());
}

function existingLocalImage(conversationId, messageId) {
  const base = path.join(ROOT, "data", "conv-images", conversationId);
  const candidates = [
    { ext: "jpg", mime: "image/jpeg" },
    { ext: "jpeg", mime: "image/jpeg" },
    { ext: "png", mime: "image/png" },
    { ext: "webp", mime: "image/webp" },
  ];
  for (const candidate of candidates) {
    const absolutePath = path.join(base, `${messageId}.${candidate.ext}`);
    if (fs.existsSync(absolutePath)) {
      return { absolutePath, ext: candidate.ext, mime: candidate.mime };
    }
  }
  return null;
}

function pickExtFromMime(mime, fallback = "jpg") {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return fallback;
}

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { Accept: "image/*,*/*;q=0.8" } });
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, mime };
}

async function ensureBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`listBuckets faalde: ${error.message}`);
  if ((buckets ?? []).some((b) => b.name === BUCKET)) return;
  const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 12 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (createErr) {
    const msg = (createErr.message ?? "").toLowerCase();
    if (!msg.includes("already exists") && !msg.includes("duplicate")) {
      throw new Error(`createBucket faalde: ${createErr.message}`);
    }
  }
}

async function uploadToSupabaseStorage(supabase, { storagePath, buffer, mime }) {
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: mime,
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`upload ${storagePath} faalde: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const url = data?.publicUrl?.trim();
  if (!url) throw new Error(`getPublicUrl gaf lege URL voor ${storagePath}`);
  return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  loadEnvFromDotenvLocal();

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY zijn verplicht (.env.local of env).");
  }

  let supabaseHost = "";
  try {
    supabaseHost = new URL(supabaseUrl).hostname;
  } catch {
    /* ignore */
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log(
    `Mode: ${APPLY ? "APPLY (writes naar Supabase Storage + DB)" : "DRY-RUN (geen writes)"}`
  );
  console.log(`Bucket: ${BUCKET} @ ${supabaseHost || supabaseUrl}`);
  if (SKIP_REMOTE) console.log("Skip remote (https) bronnen aangezet.");

  if (APPLY) {
    await ensureBucket(supabase);
  }

  // 1) Haal alle profile_media rows op. We migreren alleen rijen waarvan de
  //    huidige URL niet al naar onze Supabase Storage bucket wijst.
  const { data: mediaRows, error: mediaErr } = await supabase
    .from("profile_media")
    .select("id, profile_id, url");
  if (mediaErr) throw new Error(`profile_media query faalde: ${mediaErr.message}`);

  const rows = (mediaRows ?? []).filter(
    (r) => !isAlreadySupabaseStorageUrl(r.url, supabaseHost)
  );
  if (rows.length === 0) {
    console.log("Geen rijen om te migreren — alle URLs wijzen al naar Supabase Storage.");
    return;
  }
  console.log(`Te migreren rijen: ${rows.length}`);

  /** Map oude URL → nieuwe Supabase Storage URL (voor profiles avatar/photo_urls cleanup). */
  const urlMapping = new Map();
  let migratedFromLocal = 0;
  let migratedFromRemote = 0;
  let missingLocal = 0;
  let skippedRemote = 0;
  let errors = 0;

  for (const row of rows) {
    const oldUrl = String(row.url ?? "").trim();
    if (!oldUrl) continue;

    /** Bepaal bron: legacy proxy URL (lokale fs) of externe http(s) URL. */
    const legacy = legacyProxyParts(oldUrl);
    let bytes = null;
    let mime = "image/jpeg";
    let convId = null;
    let msgId = null;

    if (legacy) {
      convId = legacy.conversationId;
      msgId = legacy.messageId;
      const file = existingLocalImage(legacy.conversationId, legacy.messageId);
      if (!file) {
        missingLocal += 1;
        console.warn(`[miss-local] ${oldUrl} — geen lokaal bestand`);
        continue;
      }
      try {
        bytes = fs.readFileSync(file.absolutePath);
        mime = file.mime;
      } catch (e) {
        errors += 1;
        console.warn(`[read-error] ${file.absolutePath}: ${e.message}`);
        continue;
      }
    } else if (isRemoteUrl(oldUrl)) {
      if (SKIP_REMOTE) {
        skippedRemote += 1;
        continue;
      }
      /** Probeer convId/msgId te herleiden uit pad. Anders profile_id + row.id als prefix. */
      try {
        const u = new URL(oldUrl);
        const parts = u.pathname.split("/").filter(Boolean);
        const last = parts[parts.length - 1] ?? "";
        const second = parts[parts.length - 2] ?? "";
        msgId = (last.replace(/\.[a-z0-9]+$/i, "") || row.id).slice(0, 80);
        convId = second || `profile-${row.profile_id ?? "unknown"}`;
        const dl = await downloadBuffer(oldUrl);
        bytes = dl.buffer;
        mime = dl.mime;
      } catch (e) {
        errors += 1;
        console.warn(`[remote-error] ${oldUrl}: ${e.message}`);
        continue;
      }
    } else {
      console.warn(`[unsupported] ${oldUrl}`);
      continue;
    }

    if (!bytes || bytes.length < 256) {
      errors += 1;
      console.warn(`[empty] ${oldUrl}`);
      continue;
    }

    const ext = pickExtFromMime(mime);
    const safeMsg = (msgId ?? "img").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120);
    const safeConv = (convId ?? "x").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120);
    const storagePath = `legacy-profile-media/${safeConv}/${safeMsg}.${ext}`;

    if (!APPLY) {
      console.log(`[dry] would upload ${oldUrl} → ${BUCKET}/${storagePath}`);
      urlMapping.set(oldUrl, `(dry-run pending) ${storagePath}`);
      if (legacy) migratedFromLocal += 1;
      else migratedFromRemote += 1;
      continue;
    }

    let newUrl;
    try {
      newUrl = await uploadToSupabaseStorage(supabase, { storagePath, buffer: bytes, mime });
    } catch (e) {
      errors += 1;
      console.warn(`[upload-error] ${storagePath}: ${e.message}`);
      continue;
    }

    const { error: updateErr } = await supabase
      .from("profile_media")
      .update({ url: newUrl })
      .eq("id", row.id);
    if (updateErr) {
      errors += 1;
      console.warn(`[db-update-error] row=${row.id}: ${updateErr.message}`);
      continue;
    }
    urlMapping.set(oldUrl, newUrl);
    if (legacy) migratedFromLocal += 1;
    else migratedFromRemote += 1;
    console.log(`[ok] ${oldUrl} → ${newUrl}`);
  }

  // 2) Update ook `profiles.avatar_url` + `profiles.photo_urls` voor zover die
  //    naar de oude URL's wijzen, zodat de Profielen UI hetzelfde laat zien.
  let touchedProfiles = 0;
  if (urlMapping.size > 0) {
    const { data: profiles, error: profilesErr } = await supabase
      .from("profiles")
      .select("id, avatar_url, photo_urls");
    if (profilesErr) throw new Error(`profiles query faalde: ${profilesErr.message}`);

    for (const profile of profiles ?? []) {
      const currentAvatar =
        typeof profile.avatar_url === "string" ? profile.avatar_url : null;
      const currentPhotos = Array.isArray(profile.photo_urls) ? profile.photo_urls : [];

      const nextAvatar =
        currentAvatar && urlMapping.has(currentAvatar)
          ? urlMapping.get(currentAvatar)
          : currentAvatar;
      const nextPhotos = currentPhotos.map((url) =>
        urlMapping.has(url) ? urlMapping.get(url) : url
      );

      const avatarChanged = nextAvatar !== currentAvatar;
      const photosChanged = JSON.stringify(nextPhotos) !== JSON.stringify(currentPhotos);
      if (!avatarChanged && !photosChanged) continue;
      touchedProfiles += 1;
      if (!APPLY) continue;

      const patch = {};
      if (avatarChanged) patch.avatar_url = nextAvatar;
      if (photosChanged) patch.photo_urls = nextPhotos;
      const { error: updateErr } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", profile.id);
      if (updateErr) {
        errors += 1;
        console.warn(`[profile-update-error] ${profile.id}: ${updateErr.message}`);
      }
    }
  }

  console.log("");
  console.log("──── samenvatting ────");
  console.log(`mode:                            ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`profile_media rijen onderzocht:  ${rows.length}`);
  console.log(`gemigreerd vanaf lokaal fs:      ${migratedFromLocal}`);
  console.log(`gemigreerd vanaf remote URL:     ${migratedFromRemote}`);
  console.log(`overgeslagen remote:             ${skippedRemote}`);
  console.log(`geen lokaal bestand gevonden:    ${missingLocal}`);
  console.log(`profielen met url-vervanging:    ${touchedProfiles}`);
  console.log(`fouten:                          ${errors}`);
  if (!APPLY) {
    console.log("Geen writes gedaan. Voeg --apply toe om DB-updates uit te voeren.");
  }
  if (missingLocal > 0) {
    console.log(
      "TIP: rijen zonder lokaal bestand komen waarschijnlijk uit een eerdere Vercel-deploy."
    );
    console.log("     Re-genereer die profielen via /admin → 'Nieuw random profiel' of accept het verlies.");
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
