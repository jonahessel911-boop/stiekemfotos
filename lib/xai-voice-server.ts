/**
 * Server-side xAI voice helpers — gebruikt XAI_API_KEY uit omgeving.
 * Nooit vanuit de browser aanroepen met je echte key.
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

export async function xaiSpeechToText(
  audio: ArrayBuffer,
  options?: { mimeType?: string; filename?: string; language?: string }
): Promise<string> {
  const key = requireXaiApiKey();
  const blob = new Blob([audio], {
    type: options?.mimeType || "audio/webm",
  });
  const form = new FormData();
  form.append("file", blob, options?.filename || "voice.webm");
  form.append("model", process.env.XAI_STT_MODEL || "grok-2-audio-transcribe");
  if (options?.language?.trim()) {
    form.append("language", options.language.trim());
  }

  const res = await fetch("https://api.x.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: form,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`STT (${res.status}): ${raw.slice(0, 400)}`);
  }
  try {
    const json = JSON.parse(raw) as { text?: string; transcript?: string };
    return (json.text || json.transcript || "").trim();
  } catch {
    return raw.trim();
  }
}
