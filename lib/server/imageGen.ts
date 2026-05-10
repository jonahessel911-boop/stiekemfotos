import { mkdir, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import type { Profile } from "@/lib/types/profile";
import { buildStableVisualIdentityForProfile } from "@/lib/server/profileVisualIdentity";

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
  "Photorealistic amateur smartphone photograph, single exposure, handheld candid composition, natural messy indoor lighting, entire frame is one continuous shot of one woman. ";

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
  messageId: string
): Promise<{ filename: string; error?: never } | { filename?: never; error: string }> {
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
  const targetPath = path.join(outputDir, targetFilename);
  await writeFile(targetPath, imgBuffer);
  return { filename: targetFilename };
}

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
  await mkdir(outputDir, { recursive: true });
  const promptHash = createHash("sha256")
    .update(finalizePromptForZModel(prompt))
    .digest("hex")
    .slice(0, 12);
  const startedAt = Date.now();

  // Primary/only provider: ZModel Turbo API (finaliseert prompt intern: max 1000 chars + single-frame prefix)
  const zResult = await tryGenerateWithZModel(
    { prompt, width, height, steps: options.steps, seed, randomSeed },
    outputDir,
    messageId
  );
  if (zResult.filename) {
    const durationMs = Date.now() - startedAt;
    console.info(
      `[imageGen] provider=zmodel prompt_hash=${promptHash} duration_ms=${durationMs} success=true`
    );
    return {
      status: "success",
      filename: zResult.filename,
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
  const identity =
    profile.visualIdentityPrompt?.trim().replace(/\s+/g, " ") ||
    buildStableVisualIdentityForProfile(profile);
  const scene = userRequest.trim() || "amateur smartphone photo realistic lighting same woman as profile";
  return `${identity}, scene: ${scene}`;
}
