import { mkdir, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import type { Profile } from "@/lib/types/profile";
import { buildStableVisualIdentityForProfile } from "@/lib/server/profileVisualIdentity";
import { tryUploadImageToStorage } from "@/lib/server/imageStorage";

const ZMODEL_API_KEY = process.env.ZMODEL_API_KEY?.trim() || "";
const ZMODEL_BASE_URL = process.env.ZMODEL_BASE_URL?.trim() || "https://zimageturbo.ai";
const ZMODEL_POLL_MS = 2000;
const ZMODEL_TIMEOUT_MS = 120_000;
const ZMODEL_CREATE_RETRIES = 4;
const ZMODEL_STATUS_RETRIES = 3;
const ALLOWED_ASPECT_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]);

/** Z Image Turbo API: prompt max 1000 chars (docs). Lange prompts worden server-side afgekapt. */
export const ZMODEL_PROMPT_MAX_CHARS = 1000;

/**
 * Natuurlijke zinnen (geen ALL CAPS slogan) — die woorden werden op verificatiebriefjes geschilderd.
 * Geen woorden grid/raster (prikkelen het model).
 */
const ZMODEL_SINGLE_FRAME_PREFIX =
  "Photorealistic amateur SELFIE smartphone photograph. One single rectangular photo frame, exactly one face visible in the entire image, exactly one body visible, one continuous unbroken composition from one camera angle. The woman herself is holding the phone and taking the photo, either by extending her own arm into the frame or as a bedroom mirror selfie where the phone is visible in her hand. No second person present, no tripod, no professional photographer, looks like a normal iPhone snap she sent herself in a chat. Natural messy indoor lighting, candid, slightly imperfect. ";

export type GenerationStatus = "success" | "nsfw_blocked" | "failed";

export type GenerateImageOptions = {
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  randomSeed?: boolean;
};

export type GenerateImageDetailedResult = {
  status: GenerationStatus;
  filename: string | null;
  /** Persistent publieke URL (Supabase Storage). Aanwezig bij `status === "success"` als upload slaagt. */
  publicUrl?: string | null;
  seed?: number | null;
  durationS?: number;
  errorDetail?: string;
};

type ZModelGenerateResponse = {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    status?: string;
  };
};

type ZModelStatusResponse = {
  code?: number;
  message?: string;
  data?: {
    status?: string;
    task_id?: string;
    response?: string[];
    error_message?: string | null;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFirstImageUrl(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return extractFirstImageUrl(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractFirstImageUrl(item);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj.image_url === "string") return obj.image_url;
    if (typeof obj.src === "string") return obj.src;
    if (obj.response) return extractFirstImageUrl(obj.response);
    if (obj.images) return extractFirstImageUrl(obj.images);
  }
  return null;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Max lengte van user prompt vóór server-side prefix (ZModel max 1000). */
export function zModelMaxUserPromptBodyChars(): number {
  return ZMODEL_PROMPT_MAX_CHARS - ZMODEL_SINGLE_FRAME_PREFIX.length;
}

/**
 * Voor chat-foto's: strip de poetische, gezicht-zware bijzinnen uit de visual identity
 * (bv. "cascading over her shoulders", "glows softly in natural light", "with a gentle gaze")
 * en hard cap op ~MAX_CHARS chars. Anders concurreert de identity met de daadwerkelijke fotowens
 * en valt Z Image terug op een face-portrait, ongeacht de framing/nudity/region rules.
 *
 * We behouden: naam, leeftijd, heritage, basis-haarkleur, basis-oogkleur, body-type, "same person as profile photos".
 * We verwijderen: lange adjectief-strings, sensorische beschrijvingen, narratieve face-omschrijvingen.
 */
export function compactIdentityForChatPhotoPrompt(identity: string, maxChars = 180): string {
  let s = identity.replace(/\s+/g, " ").trim();

  // Verwijder narratieve hair-/skin-/eye-bijzinnen (alles vanaf "with/that/featuring" tot komma/punt).
  s = s
    .replace(/\b(?:cascading|flowing|tumbling|falling|framing|wavy[- ]ish|softly\s*waving)\s+[^,.;]*[,.;]/gi, "")
    .replace(/\bthat\s+(?:glows?|shines?|catches?|reflects?|frames?|highlights?)[^,.;]*[,.;]/gi, "")
    .replace(/\bwith\s+(?:a\s+)?(?:gentle|warm|soft|piercing|striking|alluring|sultry|seductive|innocent)\s+(?:gaze|look|expression|smile|stare|grin)[^,.;]*[,.;]/gi, "")
    .replace(/\b(?:rich|deep|luxurious|silky|glossy|glowing|radiant|porcelain|flawless|smooth|delicate)\s+/gi, "")
    .replace(/\b(?:softly|gently|naturally|warmly|beautifully|gorgeously|effortlessly)\s+/gi, "")
    .replace(/\bin\s+natural\s+light[^,.;]*[,.;]/gi, "")
    .replace(/\b(?:striking|stunning|captivating|alluring|seductive|piercing|gorgeous|beautiful|breathtaking)\s+/gi, "");

  s = s.replace(/\s+/g, " ").replace(/\s*,\s*,+/g, ", ").replace(/\s*([,.;])\s*/g, "$1 ").trim();

  // Hard cap — snij netjes op woordgrens.
  if (s.length > maxChars) {
    const cut = s.slice(0, maxChars);
    const lastBreak = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(" "));
    s = (lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd().replace(/[,.;]+$/g, "");
  }

  return s;
}

/**
 * Voor chat-foto's waar de USER een specifieke body/clothing wens heeft (bv. "roze stringetje",
 * "bovenlijf zonder iets aan", "naakt op bed"): bouw een body-focused descriptor uit de identity
 * die GEEN "eyes", "face", "facial features", "lips" tokens bevat. Die woorden in de prompt
 * pushen Z Image richting een face-portrait, ongeacht de gevraagde framing/kleding.
 *
 * Behouden: heritage hint zonder "face", haarkleur+stijl, huid, body-type, sieraden.
 * Verwijderd: "eyes", "facial structure", "face filling", "gaze", "lips", "mouth", "expression",
 *             en de "Northern European Dutch facial features" subzin (alleen "Dutch heritage").
 */
export function buildBodyShotIdentityDescriptor(identity: string, maxChars = 240): string {
  let s = identity.replace(/\s+/g, " ").trim();

  // 1. Verwijder face-portrait triggers (eyes / face / facial / lips / mouth / gaze / expression).
  s = s
    .replace(/\([^)]*facial[^)]*\)/gi, "") // "(Northern European Dutch facial features, ...)"
    .replace(/,?\s*identical\s+facial\s+structure\s+and\s+body\s+proportions[^,.;]*/gi, ", same body proportions")
    .replace(/,?\s*[^,.;]*\b(?:facial\s+features?|facial\s+structure|face\s+shape|lip\s+shape|lips?|mouth|gaze|expression|eye\s+shape|eyelids?)\b[^,.;]*/gi, "")
    .replace(/,?\s*(?:bright|piercing|striking|soft|deep|warm|sparkling|alluring|seductive|innocent)?\s*(?:blue|green|brown|hazel|grey|gray|amber|dark|light)?\s*-?\s*(?:blue|green|brown|hazel|grey|gray|amber)?\s+eyes\b[^,.;]*/gi, "")
    .replace(/,?\s*\b(?:almond|monolid|double\s*eyelid)[^,.;]*\beyes?\b[^,.;]*/gi, "")
    .replace(/,?\s*\beyes?\b[^,.;]*/gi, "")
    .replace(/,?\s*\bface\b[^,.;]*/gi, "");

  // 2. Verwijder narratieve / sensorische / framing termen.
  s = s
    .replace(/\b(?:cascading|flowing|tumbling|falling|framing|wavy[- ]ish|softly\s*waving)\s+[^,.;]*[,.;]/gi, "")
    .replace(/\b(?:rich|deep|luxurious|silky|glossy|glowing|radiant|porcelain|flawless|smooth|delicate)\s+/gi, "")
    .replace(/\b(?:softly|gently|naturally|warmly|beautifully|gorgeously|effortlessly)\s+/gi, "")
    .replace(/\b(?:striking|stunning|captivating|alluring|seductive|piercing|gorgeous|beautiful|breathtaking)\s+/gi, "")
    .replace(/\bin\s+natural\s+light[^,.;]*[,.;]/gi, "")
    .replace(/,?\s*one\s+candid\s+uncropped\s+snapshot[^,.;]*/gi, "")
    .replace(/\bfilling\s+the\s+frame\s+edge\s+to\s+edge\b/gi, "")
    .replace(/\b(?:edge\s+to\s+edge|face\s*filling|face[- ]?filling|portrait\s+fills?\s+the\s+frame)\b/gi, "");

  // 3. Opschonen: dubbele kommas, spaties, dashes.
  s = s
    .replace(/\s*—\s*/g, " — ")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s*([,.;])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.\-—]+/, "")
    .replace(/[\s,;:.\-—]+$/, "")
    .trim();

  // 4. Hard cap op woordgrens.
  if (s.length > maxChars) {
    const cut = s.slice(0, maxChars);
    const lastBreak = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(" "));
    s = (lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd().replace(/[,.;]+$/g, "");
  }

  return s;
}

/** Zelfde sanering als admin random profile → ZModel: geen grid/collage-termen die het model triggeren. */
export function sanitizeIdentityForZImagePrompt(identity: string): string {
  return (
    identity
      // Verwijder anti-collage instructies — die laten we elders staan
      .replace(/\b(?:never|no|not)\s+[^.,;]*(?:grid|collage|raster|multi[- ]?panel|contact sheet|filmstrip)[^.]*\./gi, "")
      .replace(/\b(?:grid|collage|raster|contact sheets?|filmstrips?|multi[- ]?panels?|9[- ]?panels?|thumbnail\s*strips?)\b/gi, "")
      // Verwijder framing/setup instructies uit identity — die mag de chat-prompt zelf bepalen.
      // Zonder dit forceert "filling the frame edge to edge" + "smartphone in mirror"
      // het model standaard naar een face-only mirror selfie, ongeacht onze framing rule.
      .replace(/,?\s*black smartphone[^,.;]*?(?:in|in the)\s*mirror[^,.;]*/gi, "")
      .replace(/,?\s*dark phone case[^,.;]*?(?:in|in the)\s*reflection[^,.;]*/gi, "")
      .replace(/,?\s*(?:black|dark)?\s*smartphone[^,.;]*?(?:in|in the)\s*(?:mirror|reflection)[^,.;]*/gi, "")
      .replace(/;?\s*one\s+candid\s+uncropped\s+snapshot\s+filling\s+the\s+frame\s+edge\s+to\s+edge\b/gi, "")
      .replace(/\bfilling\s+the\s+frame\s+edge\s+to\s+edge\b/gi, "")
      .replace(/\buncropped\s+snapshot\b/gi, "snapshot")
      .replace(/\b(?:edge\s+to\s+edge|face\s*filling|face[- ]?filling|portrait\s+fills?\s+the\s+frame)\b/gi, "")
      .replace(/\s*—\s*$/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*,+/g, ", ")
      .replace(/\s*([,.;])\s*/g, "$1 ")
      .trim()
  );
}

export function finalizePromptForZModel(userPrompt: string): string {
  const body = userPrompt.replace(/\s+/g, " ").trim();
  const prefix = ZMODEL_SINGLE_FRAME_PREFIX;
  const maxBody = ZMODEL_PROMPT_MAX_CHARS - prefix.length;
  if (maxBody < 64) {
    return prefix.slice(0, ZMODEL_PROMPT_MAX_CHARS).trim();
  }
  if (body.length <= maxBody) {
    return `${prefix}${body}`;
  }
  return `${prefix}${body.slice(0, maxBody).trimEnd()}`;
}

function aspectRatioForSize(width: number, height: number): string {
  const d = gcd(width, height);
  const ratio = `${Math.floor(width / d)}:${Math.floor(height / d)}`;
  if (!ALLOWED_ASPECT_RATIOS.has(ratio)) {
    throw new Error(
      `Unsupported aspect ratio ${ratio}. Allowed: ${Array.from(ALLOWED_ASPECT_RATIOS).join(", ")}`
    );
  }
  return ratio;
}

async function tryGenerateWithZModel(
  options: GenerateImageOptions,
  outputDir: string,
  conversationId: string,
  messageId: string
): Promise<
  | { filename: string; publicUrl: string | null; error?: never }
  | { filename?: never; publicUrl?: never; error: string }
> {
  if (!ZMODEL_API_KEY) {
    return { error: "ZMODEL_API_KEY ontbreekt." };
  }
  const aspectRatio = aspectRatioForSize(options.width ?? 1024, options.height ?? 1024);
  let createRaw = "";
  let createStatus = 0;
  for (let attempt = 1; attempt <= ZMODEL_CREATE_RETRIES; attempt += 1) {
    const createRes = await fetch(`${ZMODEL_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "stiekefotos-image-worker/1.0",
        Authorization: `Bearer ${ZMODEL_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: finalizePromptForZModel(options.prompt),
        aspect_ratio: aspectRatio,
      }),
    });
    createStatus = createRes.status;
    createRaw = await createRes.text();
    if (createRes.ok) break;
    const looksHtml = /^\s*</.test(createRaw);
    const retryable = createRes.status >= 500 || createRes.status === 429 || looksHtml;
    if (!retryable || attempt >= ZMODEL_CREATE_RETRIES) {
      return {
        error: `ZModel generate error ${createRes.status}: ${createRaw.slice(0, 300)}`,
      };
    }
    await sleep(700 * attempt);
  }
  if (createStatus < 200 || createStatus >= 300) {
    return { error: `ZModel generate error ${createStatus}: ${createRaw.slice(0, 300)}` };
  }
  let created: ZModelGenerateResponse;
  try {
    created = JSON.parse(createRaw) as ZModelGenerateResponse;
  } catch (e) {
    return { error: `ZModel generate gaf ongeldige JSON terug: ${String(e)}` };
  }
  const taskId = created.data?.task_id?.trim();
  if (!taskId) {
    return { error: "ZModel generate response bevat geen task_id." };
  }

  const started = Date.now();
  let imageUrl: string | null = null;
  let lastStatus = created.data?.status ?? "IN_PROGRESS";
  while (Date.now() - started < ZMODEL_TIMEOUT_MS) {
    await sleep(ZMODEL_POLL_MS);
    let statusRaw = "";
    let statusCode = 0;
    for (let attempt = 1; attempt <= ZMODEL_STATUS_RETRIES; attempt += 1) {
      const statusRes = await fetch(
        `${ZMODEL_BASE_URL}/api/status?task_id=${encodeURIComponent(taskId)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "stiekefotos-image-worker/1.0",
            Authorization: `Bearer ${ZMODEL_API_KEY}`,
          },
        }
      );
      statusCode = statusRes.status;
      statusRaw = await statusRes.text();
      if (statusRes.ok) break;
      const looksHtml = /^\s*</.test(statusRaw);
      const retryable = statusRes.status >= 500 || statusRes.status === 429 || looksHtml;
      if (!retryable || attempt >= ZMODEL_STATUS_RETRIES) {
        return { error: `ZModel status error ${statusRes.status}: ${statusRaw.slice(0, 300)}` };
      }
      await sleep(500 * attempt);
    }
    if (statusCode < 200 || statusCode >= 300) {
      return { error: `ZModel status error ${statusCode}: ${statusRaw.slice(0, 300)}` };
    }
    let statusData: ZModelStatusResponse;
    try {
      statusData = JSON.parse(statusRaw) as ZModelStatusResponse;
    } catch (e) {
      return { error: `ZModel status gaf ongeldige JSON terug: ${String(e)}` };
    }
    lastStatus = (statusData.data?.status ?? "").toUpperCase();
    if (lastStatus === "SUCCESS") {
      imageUrl = extractFirstImageUrl(statusData.data?.response);
      if (!imageUrl) {
        return {
          error: `ZModel SUCCESS maar zonder bruikbare image URL. response=${JSON.stringify(
            statusData.data?.response
          ).slice(0, 300)}`,
        };
      }
      break;
    }
    if (lastStatus === "FAILED" || lastStatus === "ERROR") {
      return {
        error: `ZModel task ${lastStatus}: ${statusData.data?.error_message || statusData.message || "onbekende fout"}`,
      };
    }
  }
  if (!imageUrl) {
    return { error: `ZModel timeout. Laatste status: ${lastStatus}` };
  }
  const imgRes = await fetch(imageUrl, {
    headers: { Accept: "image/*,*/*;q=0.8" },
  });
  if (!imgRes.ok) {
    return { error: `ZModel image download failed (${imgRes.status}).` };
  }
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  if (imgBuffer.length < 1024) {
    return { error: "ZModel gaf lege/ongeldige image bytes terug." };
  }
  const targetFilename = `${messageId}.jpg`;
  /**
   * 1) Best-effort lokaal schrijven — handig in dev en als instant warm-cache
   *    in dezelfde lambda. Op productie verdwijnt dit bestand bij koude start;
   *    de Supabase Storage upload (stap 2) is daarom de eigenlijke bron van waarheid.
   */
  try {
    const targetPath = path.join(outputDir, targetFilename);
    await writeFile(targetPath, imgBuffer);
  } catch (e) {
    console.warn(
      "[imageGen] local writeFile failed (continuing with Supabase upload)",
      e instanceof Error ? e.message : String(e)
    );
  }

  /**
   * 2) Persistent storage in Supabase. Bij falen returnen we toch success
   *    op basis van local fs; de chat image route heeft een blob/profile_media
   *    fallback voor legacy data. In dev zonder Supabase blijft alleen local.
   */
  const upload = await tryUploadImageToStorage({
    pathSegments: ["chat-images", conversationId, targetFilename],
    buffer: imgBuffer,
    mime: "image/jpeg",
    upsert: true,
  });
  return { filename: targetFilename, publicUrl: upload?.publicUrl ?? null };
}

/**
 * Backwards-compatible: callers die alleen de filename nodig hebben.
 * Voor nieuw werk: gebruik `generateRealisticImageDetailed` zodat je ook `publicUrl` hebt.
 */
export async function generateRealisticImage(
  options: GenerateImageOptions,
  conversationId: string,
  messageId: string
): Promise<string | null> {
  const detailed = await generateRealisticImageDetailed(options, conversationId, messageId);
  return detailed.filename;
}

export async function generateRealisticImageDetailed(
  options: GenerateImageOptions,
  conversationId: string,
  messageId: string
): Promise<GenerateImageDetailedResult> {
  const {
    prompt,
    width = 1024,
    height = 1024,
    seed = 42,
    randomSeed = true,
  } = options;
  const outputDir = path.join(process.cwd(), "data", "conv-images", conversationId);
  await mkdir(outputDir, { recursive: true }).catch(() => {
    /** Read-only fs (Vercel) — Supabase upload is leidend, lokale write is best-effort. */
  });
  const promptHash = createHash("sha256")
    .update(finalizePromptForZModel(prompt))
    .digest("hex")
    .slice(0, 12);
  const startedAt = Date.now();

  // Primary/only provider: ZModel Turbo API (finaliseert prompt intern: max 1000 chars + single-frame prefix)
  const zResult = await tryGenerateWithZModel(
    { prompt, width, height, steps: options.steps, seed, randomSeed },
    outputDir,
    conversationId,
    messageId
  );
  if (zResult.filename) {
    const durationMs = Date.now() - startedAt;
    console.info(
      `[imageGen] provider=zmodel prompt_hash=${promptHash} duration_ms=${durationMs} success=true supabase=${zResult.publicUrl ? "yes" : "no"}`
    );
    return {
      status: "success",
      filename: zResult.filename,
      publicUrl: zResult.publicUrl,
      seed: null,
      durationS: durationMs / 1000,
    };
  }
  const durationMs = Date.now() - startedAt;
  console.error(
    `[imageGen] provider=zmodel prompt_hash=${promptHash} duration_ms=${durationMs} success=false error="${zResult.error}"`
  );
  return {
    status: "failed",
    filename: null,
    durationS: durationMs / 1000,
    errorDetail: zResult.error,
  };
}

export function buildNudePrompt(profile: Profile, userRequest: string): string {
  const identityRaw =
    profile.visualIdentityPrompt?.trim().replace(/\s+/g, " ") ||
    buildStableVisualIdentityForProfile(profile);
  const identity = sanitizeIdentityForZImagePrompt(identityRaw);
  const scene = userRequest.trim() || "amateur smartphone photo realistic lighting same woman as profile";
  /** Identiteit vooraan — zie `finalizePromptForZModel` (knipt het einde af bij overflow). */
  return `${identity}. Scene: ${scene}`;
}
