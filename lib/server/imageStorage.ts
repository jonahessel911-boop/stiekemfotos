/**
 * Centrale image-storage helper.
 *
 * Alle profiel-, chat- en gegenereerde foto's worden via deze module geupload
 * naar Supabase Storage (publieke bucket). Lokaal filesystem wordt alleen nog
 * gebruikt als laatste fallback in dev (geen Supabase service-role key).
 *
 * Voordelen:
 *  - Persistent over deploys, koude lambdas en cross-region serverless calls.
 *  - Eén public CDN-URL die direct in `<img src>` kan zonder proxy.
 *  - Geen eindeloze `/api/conversations/.../image/...` proxy-roundtrips meer.
 */
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

/** Eén centrale bucket voor alle image-assets. Public read, write alleen via service-role. */
export const IMAGE_BUCKET = "profile-media";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

let bucketEnsuredAt = 0;
const BUCKET_TTL_MS = 5 * 60 * 1000;

/**
 * Zorgt dat de centrale bucket bestaat en publiek is. Idempotent + gecached
 * voor 5 min zodat we niet bij elke upload een listBuckets call doen.
 */
async function ensureImageBucket(): Promise<boolean> {
  const now = Date.now();
  if (now - bucketEnsuredAt < BUCKET_TTL_MS) return true;
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  try {
    const { data: buckets, error } = await admin.storage.listBuckets();
    if (error) {
      console.warn("[imageStorage] listBuckets failed:", error.message);
      return false;
    }
    const exists = (buckets ?? []).some((b) => b.name === IMAGE_BUCKET);
    if (!exists) {
      const { error: createErr } = await admin.storage.createBucket(IMAGE_BUCKET, {
        public: true,
        fileSizeLimit: 12 * 1024 * 1024,
        allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      });
      if (createErr) {
        /** Race: een andere lambda heeft net dezelfde bucket gemaakt — telt als success. */
        const msg = (createErr.message ?? "").toLowerCase();
        if (!msg.includes("already exists") && !msg.includes("duplicate")) {
          console.warn("[imageStorage] createBucket failed:", createErr.message);
          return false;
        }
      }
    }
    bucketEnsuredAt = now;
    return true;
  } catch (e) {
    console.warn(
      "[imageStorage] ensureImageBucket exception:",
      e instanceof Error ? e.message : String(e)
    );
    return false;
  }
}

function pickExtFromMime(mime: string): "jpg" | "png" | "webp" {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

function normalizeMime(mime: string): string {
  const m = (mime ?? "").toLowerCase().trim();
  if (m === "image/jpg" || m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return "image/jpeg";
}

/** Slug-veilig pad-segment: alleen [a-z0-9_-], rest naar `-`. */
function sanitizePathSegment(s: string): string {
  return (s ?? "")
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "x";
}

export type UploadImageResult = {
  /** Volledige publieke Supabase Storage URL (direct bruikbaar in <img src>). */
  publicUrl: string;
  /** Het pad binnen de bucket (zonder bucket-naam, zonder host). */
  storagePath: string;
  /** Hoe de upload terechtkwam — handig voor logging. */
  provider: "supabase";
};

/**
 * Upload een image-buffer naar Supabase Storage en geef de publieke URL terug.
 * `pathSegments` worden gesanitized en aan elkaar gelijmd; extensie wordt
 * afgeleid uit `mime` als de laatste segment er nog geen heeft.
 *
 * Throws als Supabase ontbreekt — call sites moeten dit afvangen en eventueel
 * naar lokaal fs fallback'en als ze in dev draaien.
 */
export async function uploadImageToStorage(opts: {
  pathSegments: string[];
  buffer: Buffer;
  mime: string;
  upsert?: boolean;
}): Promise<UploadImageResult> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase admin client ontbreekt — kan image niet uploaden.");
  }
  const ok = await ensureImageBucket();
  if (!ok) {
    throw new Error(`Supabase bucket ${IMAGE_BUCKET} niet beschikbaar.`);
  }

  const contentType = normalizeMime(opts.mime);
  const ext = pickExtFromMime(contentType);

  const segments = opts.pathSegments.filter((s) => s && s.trim().length > 0).map(sanitizePathSegment);
  if (segments.length === 0) {
    throw new Error("uploadImageToStorage: pathSegments mag niet leeg zijn.");
  }
  const last = segments[segments.length - 1]!;
  if (!/\.(jpe?g|png|webp)$/i.test(last)) {
    segments[segments.length - 1] = `${last}.${ext}`;
  }
  const storagePath = segments.join("/");

  const startedAt = Date.now();
  const { error: upErr } = await admin.storage
    .from(IMAGE_BUCKET)
    .upload(storagePath, opts.buffer, {
      contentType,
      upsert: opts.upsert ?? true,
      cacheControl: "31536000",
    });
  const durationMs = Date.now() - startedAt;
  if (upErr) {
    console.warn(
      `[imageStorage] upload FAIL path=${IMAGE_BUCKET}/${storagePath} bytes=${opts.buffer.length} duration_ms=${durationMs} error="${upErr.message}"`
    );
    throw new Error(
      `[imageStorage] upload ${IMAGE_BUCKET}/${storagePath} failed: ${upErr.message}`
    );
  }

  const { data } = admin.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath);
  const publicUrl = (data?.publicUrl ?? "").trim();
  if (!publicUrl) {
    console.warn(
      `[imageStorage] upload OK but getPublicUrl gaf lege URL path=${IMAGE_BUCKET}/${storagePath}`
    );
    throw new Error(`[imageStorage] getPublicUrl gaf lege URL voor ${storagePath}`);
  }
  console.info(
    `[imageStorage] upload OK path=${IMAGE_BUCKET}/${storagePath} bytes=${opts.buffer.length} duration_ms=${durationMs}`
  );
  return { publicUrl, storagePath, provider: "supabase" };
}

/**
 * Veilige variant die nooit throwt — geeft `null` terug bij falen. Handig in
 * niet-kritieke paden zoals user-uploads waar we niet willen dat een Supabase
 * outage de hele POST-flow breekt (we kunnen dan terugvallen op lokaal fs in dev).
 */
export async function tryUploadImageToStorage(
  opts: Parameters<typeof uploadImageToStorage>[0]
): Promise<UploadImageResult | null> {
  try {
    return await uploadImageToStorage(opts);
  } catch (e) {
    console.warn(
      "[imageStorage] upload failed (returning null):",
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}
