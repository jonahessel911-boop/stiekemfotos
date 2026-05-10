#!/usr/bin/env node
/**
 * Zet legacy profiel-media URLs (/api/conversations/.../image/...) om naar publieke Vercel Blob URLs.
 *
 * Standaard draait dit in dry-run mode:
 *   node scripts/migrate-legacy-profile-media-urls.mjs
 *
 * Echte writes:
 *   node scripts/migrate-legacy-profile-media-urls.mjs --apply
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const APPLY = process.argv.includes("--apply");

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

function legacyUrlParts(url) {
  const m = /^\/api\/conversations\/([^/]+)\/image\/([^/?#]+)$/.exec(url.trim());
  if (!m) return null;
  return { conversationId: m[1], messageId: m[2] };
}

function existingImageFile(conversationId, messageId) {
  const base = path.join(ROOT, "data", "conv-images", conversationId);
  const candidates = [
    { ext: "jpg", mime: "image/jpeg" },
    { ext: "jpeg", mime: "image/jpeg" },
    { ext: "png", mime: "image/png" },
  ];
  for (const candidate of candidates) {
    const absolutePath = path.join(base, `${messageId}.${candidate.ext}`);
    if (fs.existsSync(absolutePath)) {
      return { absolutePath, ext: candidate.ext, mime: candidate.mime };
    }
  }
  return null;
}

async function main() {
  loadEnvFromDotenvLocal();

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY zijn verplicht.");
  }
  if (!blobToken) {
    throw new Error("BLOB_READ_WRITE_TOKEN ontbreekt.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const { data: mediaRows, error: mediaErr } = await supabase
    .from("profile_media")
    .select("id, url")
    .like("url", "/api/conversations/%/image/%");
  if (mediaErr) throw new Error(`profile_media query faalde: ${mediaErr.message}`);

  const rows = mediaRows ?? [];
  if (rows.length === 0) {
    console.log("Geen legacy profile_media URL's gevonden.");
    return;
  }

  const mapping = new Map();
  let migratedMediaRows = 0;
  let missingLocalFiles = 0;

  for (const row of rows) {
    const oldUrl = String(row.url ?? "");
    const parsed = legacyUrlParts(oldUrl);
    if (!parsed) continue;

    const file = existingImageFile(parsed.conversationId, parsed.messageId);
    if (!file) {
      missingLocalFiles += 1;
      continue;
    }

    const fileBuf = fs.readFileSync(file.absolutePath);
    const pathname = `stiekemefotos/profile-media/${parsed.conversationId}/${parsed.messageId}.${file.ext}`;
    const blob = await put(pathname, fileBuf, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: file.mime,
      token: blobToken,
    });
    mapping.set(oldUrl, blob.url);

    if (APPLY) {
      const { error: updateErr } = await supabase
        .from("profile_media")
        .update({ url: blob.url })
        .eq("id", row.id);
      if (updateErr) {
        throw new Error(`profile_media update faalde (${row.id}): ${updateErr.message}`);
      }
    }
    migratedMediaRows += 1;
  }

  const { data: profiles, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, avatar_url, photo_urls");
  if (profilesErr) throw new Error(`profiles query faalde: ${profilesErr.message}`);

  let touchedProfiles = 0;
  for (const profile of profiles ?? []) {
    const currentAvatar = typeof profile.avatar_url === "string" ? profile.avatar_url : null;
    const currentPhotos = Array.isArray(profile.photo_urls) ? profile.photo_urls : [];

    const nextAvatar = currentAvatar && mapping.has(currentAvatar) ? mapping.get(currentAvatar) : currentAvatar;
    const nextPhotos = currentPhotos.map((url) => (mapping.has(url) ? mapping.get(url) : url));

    const avatarChanged = nextAvatar !== currentAvatar;
    const photosChanged = JSON.stringify(nextPhotos) !== JSON.stringify(currentPhotos);
    if (!avatarChanged && !photosChanged) continue;

    touchedProfiles += 1;
    if (APPLY) {
      const patch = {};
      if (avatarChanged) patch.avatar_url = nextAvatar;
      if (photosChanged) patch.photo_urls = nextPhotos;
      const { error: updateErr } = await supabase.from("profiles").update(patch).eq("id", profile.id);
      if (updateErr) {
        throw new Error(`profiles update faalde (${profile.id}): ${updateErr.message}`);
      }
    }
  }

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Legacy media rows gevonden: ${rows.length}`);
  console.log(`Migratable rows (lokaal bestand gevonden): ${migratedMediaRows}`);
  console.log(`Rows zonder lokaal bestand: ${missingLocalFiles}`);
  console.log(`Profiles met vervangbare URLs: ${touchedProfiles}`);
  if (!APPLY) {
    console.log("Geen writes gedaan. Voeg --apply toe om DB-updates uit te voeren.");
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
