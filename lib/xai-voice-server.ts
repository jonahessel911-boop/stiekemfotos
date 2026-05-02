/**
 * Server-side xAI voice helpers — gebruikt XAI_API_KEY uit omgeving.
 * Nooit vanuit de browser aanroepen met je echte key.
 */

export async function xaiTextToSpeech(
  text: string,
  options?: { voiceId?: string; language?: string }
): Promise<ArrayBuffer> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    throw new Error("XAI_API_KEY ontbreekt in .env.local — sla het bestand op en herstart de dev server.");
  }

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
