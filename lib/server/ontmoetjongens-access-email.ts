import { sendOntmoetjongensAccessEmail } from "@/lib/server/email";
import { SITE_URL } from "@/lib/server/stripe";
import {
  getStripeCheckoutBySessionId,
  upsertStripeCheckoutRecord,
} from "@/lib/server/stripeCheckoutStore";
import { createPasswordResetRequest, findUserById } from "@/lib/server/users";

export type SendAccessEmailResult = {
  sent: boolean;
  skipped?: boolean;
  reason: string;
};

/**
 * Stuurt de toegangs-e-mail na Ontmoetjongens-betaling (idempotent per sessionId).
 */
export async function sendOntmoetjongensAccessEmailIfNeeded(input: {
  sessionId: string;
  userId: string;
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

  const user = await findUserById(userId);
  if (!user) {
    return { sent: false, reason: "user_not_found" };
  }

  const reset = await createPasswordResetRequest(user.email);
  if (!reset) {
    return { sent: false, reason: "reset_token_failed" };
  }

  try {
    await sendOntmoetjongensAccessEmail({
      to: user.email,
      naam: user.naam,
      loginLink: `${SITE_URL}/wachtwoord-reset?token=${encodeURIComponent(reset.token)}`,
    });
  } catch (e) {
    console.warn(
      `[ontmoetjongens] access email mislukt session=${sessionId} user=${userId}: ${e instanceof Error ? e.message : String(e)}`
    );
    return { sent: false, reason: "email_failed" };
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

  console.log(`[ontmoetjongens] access email verstuurd naar ${user.email} (session=${sessionId})`);
  return { sent: true, reason: "ok" };
}
