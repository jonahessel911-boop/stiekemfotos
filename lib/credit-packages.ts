/** Gedeelde credit- en prijsconfiguratie (client + server). */

export type CreditPackageId = "left" | "middle" | "right";

export const CREDITS_PER_MESSAGE = 10;
export const CREDITS_PER_PHOTO_UNLOCK = 100;
/** 100 credits = 10 user-berichten gratis na signup. */
export const INITIAL_FREE_CREDITS = 100;

/** Basispakket: 100 credits voor €13,95 (72% korting). */
export const CREDIT_DEAL = {
  baseCredits: 100,
  basePriceEurCents: 1395,
  discountPercent: 72,
} as const;

export const CREDIT_PACKAGE_DEFINITIONS: Record<
  CreditPackageId,
  { credits: number; featured: boolean }
> = {
  left: { credits: 100, featured: true },
  middle: { credits: 200, featured: false },
  right: { credits: 300, featured: false },
};

export function creditsPriceEurCents(credits: number): number {
  return Math.round(credits * (CREDIT_DEAL.basePriceEurCents / CREDIT_DEAL.baseCredits));
}

export function creditsWasPriceEurCents(credits: number): number {
  return Math.round(creditsPriceEurCents(credits) / (1 - CREDIT_DEAL.discountPercent / 100));
}

export function formatPriceLabelFromCents(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export function buildCreditPackagesRecord(): Record<
  CreditPackageId,
  { credits: number; priceEurCents: number; title: string }
> {
  return {
    left: {
      credits: CREDIT_PACKAGE_DEFINITIONS.left.credits,
      priceEurCents: creditsPriceEurCents(CREDIT_PACKAGE_DEFINITIONS.left.credits),
      title: "100 credits",
    },
    middle: {
      credits: CREDIT_PACKAGE_DEFINITIONS.middle.credits,
      priceEurCents: creditsPriceEurCents(CREDIT_PACKAGE_DEFINITIONS.middle.credits),
      title: "200 credits",
    },
    right: {
      credits: CREDIT_PACKAGE_DEFINITIONS.right.credits,
      priceEurCents: creditsPriceEurCents(CREDIT_PACKAGE_DEFINITIONS.right.credits),
      title: "300 credits",
    },
  };
}

export const CREDIT_PACKAGES_DISPLAY = `${CREDIT_DEAL.baseCredits} credits = ${formatPriceLabelFromCents(CREDIT_DEAL.basePriceEurCents)} (${CREDIT_DEAL.discountPercent}% korting).

Grotere pakketten worden automatisch berekend op basis van hetzelfde tarief.`;

export const CREDITS_VOICE_LINE_NL =
  "Credits gebruik je om te chatten — 10 credits per bericht. Open de prijzen om bij te kopen.";

export const FEATURED_DEAL_CREDITS = CREDIT_DEAL.baseCredits;
export const FEATURED_DEAL_PRICE_LABEL = formatPriceLabelFromCents(CREDIT_DEAL.basePriceEurCents);
export const FEATURED_DEAL_WAS_PRICE_LABEL = formatPriceLabelFromCents(
  creditsWasPriceEurCents(CREDIT_DEAL.baseCredits)
);
export const FEATURED_DEAL_DISCOUNT_PERCENT = CREDIT_DEAL.discountPercent;
