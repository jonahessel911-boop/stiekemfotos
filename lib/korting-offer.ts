/** Referentie: platformtoegang / 100 credits-positionering (€19,99). */
export const KORTING_REFERENCE_EUR_CENTS = 1999;

/** Extra korting op de kortingspagina / abandonment-mail. */
export const KORTING_DISCOUNT_PERCENT = 62;

export const KORTING_PRICE_EUR_CENTS = Math.round(
  KORTING_REFERENCE_EUR_CENTS * (1 - KORTING_DISCOUNT_PERCENT / 100)
);

export function formatEurFromCents(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export const KORTING_REFERENCE_LABEL = formatEurFromCents(KORTING_REFERENCE_EUR_CENTS);
export const KORTING_PRICE_LABEL = formatEurFromCents(KORTING_PRICE_EUR_CENTS);

export function buildKortingPageUrl(email: string, extraParams?: Record<string, string>): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://stiekemefotos.nl";
  const u = new URL("/korting", base);
  u.searchParams.set("email", email.trim().toLowerCase());
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) u.searchParams.set(k, v);
    }
  }
  return u.toString();
}
