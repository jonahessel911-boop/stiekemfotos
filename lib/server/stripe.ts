import Stripe from "stripe";

export type CreditPackageId = "left" | "middle" | "right";

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.discreetemeisjes.nl";

export const CREDIT_PACKAGES: Record<
  CreditPackageId,
  { credits: number; priceEurCents: number; title: string }
> = {
  left: { credits: 125, priceEurCents: 999, title: "Starter" },
  middle: { credits: 250, priceEurCents: 1399, title: "Beste deal" },
  right: { credits: 75, priceEurCents: 599, title: "Mini" },
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
