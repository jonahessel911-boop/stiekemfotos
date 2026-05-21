import { sendOntmoetjongensAccessEmail } from "@/lib/server/email";
import { emailFromStripeSession } from "@/lib/server/ontmoetjongens-user";
import { SITE_URL } from "@/lib/server/stripe";
import {
  getStripeCheckoutBySessionId,
  upsertStripeCheckoutRecord,
} from "@/lib/server/stripeCheckoutStore";
import {
  createPlatformSetupRequest,
  resolveAppUserById,
} from "@/lib/server/users";
import type Stripe from "stripe";

export type SendAccessEmailResult = {
  sent: boolean;
  skipped?: boolean;
  reason: string;
  to?: string;
};

async function buildPlatformSetupLink(email: string): Promise<string | null> {
  const reset = await createPlatformSetupRequest(email);
  if (!reset) return null;
  return `${SITE_URL}/wachtwoord-reset?token=${encodeURIComponent(reset.token)}`;
}

/**
 * Stuurt de lange toegangs-e-mail (zelfde template als na Stripe-betaling).
 * Geen idempotency — bedoeld voor admin-test of handmatige resend.
 */
export async function sendPlatformAccessEmailToUser(input: {
  userId: string;
  /** Optioneel: overschrijf ontvanger (bijv. Stripe checkout e-mail). */
  toEmail?: string;
  naam?: string;
}): Promise<SendAccessEmailResult> {
  const userId = input.userId.trim();
  if (!userId) return { sent: false, reason: "missing_user_id" };

  const user = await resolveAppUserById(userId);
  if (!user) return { sent: false, reason: "user_not_found" };

  const to = (input.toEmail?.trim() || user.email).toLowerCase();
  const naam = input.naam?.trim() || user.naam;

  const loginLink = await buildPlatformSetupLink(user.email);
  if (!loginLink) return { sent: false, reason: "reset_token_failed" };

  try {
    await sendOntmoetjongensAccessEmail({ to, naam, loginLink });
  } catch (e) {
    console.warn(
      `[access-email] mislukt user=${userId} to=${to}: ${e instanceof Error ? e.message : String(e)}`
    );
    return { sent: false, reason: "email_failed", to };
  }

  console.log(`[access-email] toegangs-mail verstuurd naar ${to} (user=${userId})`);
  return { sent: true, reason: "ok", to };
}

/**
 * Stuurt de toegangs-e-mail na Ontmoetjongens-betaling (idempotent per sessionId).
 * Ontvanger = Stripe checkout e-mail wanneer beschikbaar.
 */
export async function sendOntmoetjongensAccessEmailIfNeeded(input: {
  sessionId: string;
  userId: string;
  session?: Stripe.Checkout.Session;
  stripeEmail?: string | null;
}): Promise<SendAccessEmailResult> {
  const sessionId = input.sessionId.trim();
  const userId = input.userId.trim();
  if (!sessionId || !userId) {
    return { sent: false, reason: "missing_session_or_user" };
  }

  const existing = await getStripeCheckoutBySessionId(sessionId);
  if (existing?.accessEmailSentAt) {
    return { sent: false, skipped: true, reason: "already_sent" };
  }

  const user = await resolveAppUserById(userId);
  if (!user) {
    return { sent: false, reason: "user_not_found" };
  }

  const stripeEmail =
    input.stripeEmail?.trim().toLowerCase() ||
    (input.session ? emailFromStripeSession(input.session) : "") ||
    user.email;

  const naam =
    input.session?.customer_details?.name?.trim() || user.naam;

  const result = await sendPlatformAccessEmailToUser({
    userId,
    toEmail: stripeEmail,
    naam,
  });

  if (!result.sent) {
    return result;
  }

  await upsertStripeCheckoutRecord({
    sessionId,
    userId,
    credits: existing?.credits ?? 0,
    priceEurCents: existing?.priceEurCents,
    priceLabel: existing?.priceLabel ?? "€19,95 · Ontmoetjongens",
    clickId: existing?.clickId,
    paidAt: existing?.paidAt,
    clickflareSentAt: existing?.clickflareSentAt,
    accessEmailSentAt: new Date().toISOString(),
  });

  return { ...result, reason: "ok" };
}
