import { mkdir, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";

const ZMODEL_API_KEY = process.env.ZMODEL_API_KEY?.trim() || "";
const ZMODEL_BASE_URL = process.env.ZMODEL_BASE_URL?.trim() || "https://zimageturbo.ai";
const ZMODEL_POLL_MS = 2000;
const ZMODEL_TIMEOUT_MS = 120_000;
const ALLOWED_ASPECT_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]);

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
  const createRes = await fetch(`${ZMODEL_BASE_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZMODEL_API_KEY}`,
    },
    body: JSON.stringify({
      prompt: options.prompt,
      aspect_ratio: aspectRatio,
    }),
  });
  const createRaw = await createRes.text();
  if (!createRes.ok) {
    return { error: `ZModel generate error ${createRes.status}: ${createRaw.slice(0, 300)}` };
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
    const statusRes = await fetch(
      `${ZMODEL_BASE_URL}/api/status?task_id=${encodeURIComponent(taskId)}`,
      {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ZMODEL_API_KEY}`,
      },
    }
    );
    const statusRaw = await statusRes.text();
    if (!statusRes.ok) {
      return { error: `ZModel status error ${statusRes.status}: ${statusRaw.slice(0, 300)}` };
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
  const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
  const startedAt = Date.now();

  // Primary/only provider: ZModel Turbo API
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

export function buildNudePrompt(
  profileName: string,
  heritage: string | undefined,
  userRequest: string
): string {
  void profileName;
  void heritage;
  const direct = userRequest.trim();
  if (direct.length > 0) return direct;
  return "amateur smartphone photo, realistic lighting";
}
