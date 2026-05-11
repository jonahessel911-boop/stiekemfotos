/**
 * xAI API-key voor **alle** server-calls naar api.x.ai:
 * Grok chat (`/v1/chat/completions`), spraak-naar-tekst (`/v1/stt`), TTS (`/v1/tts`).
 *
 * Standaard in `.env.local`: **XAI_API_KEY** (één waarde). Fallbacks alleen voor oude deploys/docs.
 */
export function getXaiApiKey(): string | undefined {
  const candidates = [
    process.env.XAI_API_KEY,
    process.env.GROK_API_KEY,
    process.env.XAI_KEY,
  ];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const k = raw.trim();
    if (k.length > 0) return k;
  }
  return undefined;
}

export function requireXaiApiKey(): string {
  const key = getXaiApiKey();
  if (!key) {
    throw new Error(
      "Geen xAI API-key: zet XAI_API_KEY in .env.local (zelfde key voor Grok-chat, voice-transcriptie en TTS). Alternatief: GROK_API_KEY of XAI_KEY. In productie: Vercel → Environment Variables. Herstart `npm run dev` of redeploy na wijziging."
    );
  }
  return key;
}

/** Voor HTTP-status (503) bij configuratie-fouten i.p.v. 400. */
export function isXaiConfigErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("geen xai api-key") ||
    m.includes("xai_api_key") ||
    m.includes("grok_api_key") ||
    m.includes("api-key ontbreekt")
  );
}
