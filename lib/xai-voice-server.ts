/**
 * Server-side xAI voice (STT/TTS) — **dezelfde key als Grok-chat**:
 * `requireXaiApiKey()` → vooral `XAI_API_KEY` in `.env.local`.
 *
 * STT: `POST https://api.x.ai/v1/stt` (officiële endpoint, zie
 *      https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
 * TTS: `POST https://api.x.ai/v1/tts`.
 *
 * Nooit vanuit de browser aanroepen met je echte key — gebruik altijd een
 * server route (zoals `/api/conversations/[id]/messages/voice`) als proxy.
 */

import { requireXaiApiKey } from "@/lib/xai-env";

export async function xaiTextToSpeech(
  text: string,
  options?: { voiceId?: string; language?: string }
): Promise<ArrayBuffer> {
  const key = requireXaiApiKey();

  /** eve = jong, energiek; override met XAI_TTS_VOICE (bijv. ara, sal). */
  const voiceId =
    options?.voiceId ?? process.env.XAI_TTS_VOICE ?? "eve";
  const language = options?.language ?? "auto";

  /** Zacht / ASMR-achtig: `XAI_TTS_SOFT=1` — probeert iets langzamere spraak als de API het ondersteunt, anders fallback. */
  const soft = process.env.XAI_TTS_SOFT === "1" || process.env.XAI_TTS_SOFT === "true";
  const base = {
    text: text.slice(0, 15000),
    voice_id: voiceId,
    language,
  };

  const post = (b: Record<string, unknown>) =>
    fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(b),
    });

  let res = await post(
    soft ? { ...base, speaking_rate: 0.9 } : base
  );
  if (!res.ok && soft) {
    res = await post(base);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS (${res.status}): ${err.slice(0, 400)}`);
  }

  return res.arrayBuffer();
}

/**
 * Spraak → tekst via xAI **`POST /v1/stt`** (de officiële STT-endpoint,
 * https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
 *
 * Multipart-form velden (let op: `file` moet als laatste worden toegevoegd):
 *  - `format`   — `"true"` voor natuurlijk geformatteerde tekst
 *  - `language` — taalcode (bijv. `"nl"`); standaard `XAI_STT_LANGUAGE` of `"nl"`
 *  - `file`     — audio (WAV, MP3, WebM, OGG, M4A, MP4) — **laatste veld**
 *
 * Respons: `{ "text": "..." }`. Max 500MB per file (HTTP 413 anders).
 */
export async function xaiSpeechToText(
  audio: ArrayBuffer,
  options?: {
    mimeType?: string;
    filename?: string;
    language?: string;
    /** `true` (default) → geformatteerde, natuurlijke tekst van xAI. */
    format?: boolean;
    /** Max wachttijd voor STT-call (default 25s); voorkomt hangen van /messages/voice. */
    timeoutMs?: number;
  }
): Promise<string> {
  const key = requireXaiApiKey();

  const language =
    options?.language?.trim() ||
    process.env.XAI_STT_LANGUAGE?.trim() ||
    "nl";
  const formatted = options?.format ?? true;

  /**
   * Browser MediaRecorder produceert vaak `audio/webm;codecs=opus`,
   * `audio/mp4;codecs=mp4a.40.2`, etc. Strip de codec-suffix; xAI accepteert
   * de basis MIME (`audio/webm`, `audio/mp4`, `audio/ogg`, ...).
   */
  const rawMime = (options?.mimeType || "audio/webm").toLowerCase();
  const baseMime = rawMime.split(";")[0]!.trim() || "audio/webm";
  const filename = options?.filename || `voice.${baseMime.split("/")[1] || "webm"}`;
  const blob = new Blob([audio], { type: baseMime });

  // xAI vereist dat `file` het LAATSTE veld is in de multipart-form.
  const form = new FormData();
  form.append("format", formatted ? "true" : "false");
  form.append("language", language);
  form.append("file", blob, filename);

  const timeoutMs = options?.timeoutMs ?? 25_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string }).name === "AbortError") {
      console.warn(
        `[stt] xAI STT abort/timeout (${timeoutMs}ms) mime=${baseMime} bytes=${audio.byteLength}`
      );
      throw new Error(`STT timeout (${timeoutMs}ms)`);
    }
    throw err;
  }
  clearTimeout(timer);

  const raw = await res.text();
  if (!res.ok) {
    const snippet = raw.slice(0, 400);
    console.warn(
      `[stt] xAI STT HTTP ${res.status} mime=${baseMime} bytes=${audio.byteLength} body=${snippet}`
    );
    if (res.status === 401) {
      throw new Error(
        `STT 401: ongeldige of ontbrekende XAI_API_KEY (zie console.x.ai → API Keys). ${snippet}`
      );
    }
    if (res.status === 413) {
      throw new Error(`STT 413: audio is te groot (max 500MB). ${snippet}`);
    }
    if (res.status === 429) {
      throw new Error(`STT 429: rate limited door xAI. ${snippet}`);
    }
    throw new Error(`STT (${res.status}): ${snippet}`);
  }

  try {
    const json = JSON.parse(raw) as { text?: string; transcript?: string };
    const t = (json.text || json.transcript || "").trim();
    console.info(
      `[stt] xAI STT ok mime=${baseMime} bytes=${audio.byteLength} chars=${t.length}`
    );
    return t;
  } catch {
    return raw.trim();
  }
}
