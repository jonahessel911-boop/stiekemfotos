/** Productie-domein zonder www (www heeft geen DNS). */
export const CANONICAL_SITE_ORIGIN = "https://stiekemefotos.nl";

function normalizeSiteOrigin(raw: string | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const url = new URL(withProto);
    if (!url.hostname) return null;
    // www.stiekemefotos.nl → NXDOMAIN; apex werkt wel
    if (url.hostname === "www.stiekemefotos.nl") {
      url.hostname = "stiekemefotos.nl";
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Absolute site-origin voor e-mails, Stripe redirects en API-links.
 * Normaliseert www weg en valt terug op het werkende apex-domein.
 */
export function getSiteUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  for (const c of candidates) {
    const origin = normalizeSiteOrigin(c);
    if (origin) return origin;
  }

  return CANONICAL_SITE_ORIGIN;
}

export function siteUrl(path: string): string {
  const base = getSiteUrl().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
