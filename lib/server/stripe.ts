import Stripe from "stripe";
import {
  buildCreditPackagesRecord,
  type CreditPackageId,
} from "@/lib/credit-packages";

export type { CreditPackageId };

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.stiekemefotos.nl";

/** Tarief: 100 credits = €13,95; grotere pakketten automatisch berekend. */
export const CREDIT_PACKAGES = buildCreditPackagesRecord();

/** /start — Ontmoetjongens platformtoegang (eenmalig). */
export const ONTMOETJONGENS_ONBOARDING = {
  priceEurCents: 1995,
  title: "Ontmoetjongens — platformtoegang",
  description: "Eenmalige registratie voor direct contact met jonge mannen",
} as const;

export const STRIPE_PRODUCT_ONTMOETJONGENS = "ontmoetjongens_onboarding";

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
