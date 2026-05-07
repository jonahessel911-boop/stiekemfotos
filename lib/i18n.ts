export type Locale = "nl" | "en";

export const DEFAULT_LOCALE: Locale = "nl";
export const SUPPORTED_LOCALES: readonly Locale[] = ["nl", "en"] as const;

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/**
 * Parses `Accept-Language` and returns the best supported locale.
 * Example header: "en-US,en;q=0.9,nl;q=0.8"
 */
export function detectLocaleFromAcceptLanguage(
  acceptLanguage: string | null | undefined
): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const parts = acceptLanguage
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const [tagPart, ...params] = raw.split(";").map((s) => s.trim());
      const qParam = params.find((p) => p.startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      const tag = normalizeTag(tagPart ?? "");
      const base = tag.split("-")[0] ?? tag;
      return { tag, base, q: Number.isFinite(q) ? q : 0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const p of parts) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(p.tag)) return p.tag as Locale;
    if ((SUPPORTED_LOCALES as readonly string[]).includes(p.base)) return p.base as Locale;
  }

  return DEFAULT_LOCALE;
}

