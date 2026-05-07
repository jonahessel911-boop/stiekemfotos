import Stripe from "stripe";

export type CreditPackageId = "left" | "middle" | "right";

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.discreetemeisjes.nl";

/**
 * Credit-pakketten voor het foto-platform.
 * 1 foto = 100 credits, dus 1 / 3 / 5 foto's.
 */
export const CREDIT_PACKAGES: Record<
  CreditPackageId,
  { credits: number; priceEurCents: number; title: string }
> = {
  left: { credits: 100, priceEurCents: 1999, title: "1 foto" },
  middle: { credits: 300, priceEurCents: 4999, title: "3 foto's" },
  right: { credits: 500, priceEurCents: 7499, title: "5 foto's" },
};

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY ontbreekt");
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return stripeSingleton;
}

export function resolveReturnUrl(raw?: string | null): string {
  if (!raw) return `${SITE_URL}/credits`;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return `${SITE_URL}/credits`;
    return url.toString();
  } catch {
    return `${SITE_URL}/credits`;
  }
}
