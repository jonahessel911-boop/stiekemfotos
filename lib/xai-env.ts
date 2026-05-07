/**
 * xAI / Grok API-key — meerdere env-namen omdat tooling en docs verschillen,
 * en omdat Next/Vercel soms alleen runtime-env injecteert (niet in elke worker hetzelfde gedrag).
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
      "Geen xAI API-key: zet XAI_API_KEY (aanbevolen) of GROK_API_KEY in .env.local, of in Vercel → Settings → Environment Variables voor Production/Preview, en herstart `npm run dev` / redeploy."
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
