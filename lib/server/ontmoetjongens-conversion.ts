import {
  buildSvlTxidForUser,
  formatPayoutFromCents,
  sendSvlPostback,
  SVL_CONVERSION_TYPE,
} from "@/lib/clickflare-postback";
import { getStripe, STRIPE_PRODUCT_ONTMOETJONGENS } from "@/lib/server/stripe";
import {
  getStripeCheckoutBySessionId,
  markStripeCheckoutPaid,
  upsertStripeCheckoutRecord,
} from "@/lib/server/stripeCheckoutStore";

export type OntmoetjongensConversionResult = {
  sent: boolean;
  skipped?: boolean;
  reason: string;
  clickId?: string;
};

/**
 * ClickFlare postback na Ontmoetjongens-betaling. Idempotent per Stripe session.
 * clickIdHint: cookie/body bij return van Stripe (fallback als metadata leeg was).
 */
export async function sendOntmoetjongensClickflareConversion(input: {
  sessionId: string;
  clickIdHint?: string;
}): Promise<OntmoetjongensConversionResult> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    return { sent: false, reason: "missing_session_id" };
  }

  const existing = await getStripeCheckoutBySessionId(sessionId);
  if (existing?.clickflareSentAt) {
    return { sent: false, skipped: true, reason: "already_sent", clickId: existing.clickId };
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (String(session.metadata?.productType ?? "") !== STRIPE_PRODUCT_ONTMOETJONGENS) {
    return { sent: false, reason: "not_ontmoetjongens" };
  }

  if (session.payment_status !== "paid") {
    return { sent: false, reason: "not_paid" };
  }

  await markStripeCheckoutPaid(sessionId);

  const clickId =
    input.clickIdHint?.trim() ||
    String(session.metadata?.clickId ?? "").trim() ||
    existing?.clickId?.trim() ||
    "";

  if (!clickId) {
    console.warn(
      `[clickflare:ontmoetjongens_paid] session=${sessionId} — geen click_id (metadata/cookie/leeg bij checkout)`
    );
    return { sent: false, reason: "no_click_id" };
  }

  const userId = String(session.metadata?.userId ?? "").trim();
  const stripeAmountCents =
    typeof session.amount_total === "number" && Number.isFinite(session.amount_total)
      ? session.amount_total
      : existing?.priceEurCents ?? 0;

  const postback = await sendSvlPostback({
    clickId,
    payout: formatPayoutFromCents(stripeAmountCents),
    txid: userId ? buildSvlTxidForUser(userId) : `ontmoetjongens_${sessionId}`,
    ct: SVL_CONVERSION_TYPE,
    reason: "ontmoetjongens_paid",
  });

  if (!postback.fired || !postback.ok) {
    console.warn(
      `[clickflare:ontmoetjongens_paid] postback mislukt session=${sessionId} status=${postback.status ?? "?"} err=${postback.error ?? ""}`
    );
    return { sent: false, reason: "postback_failed", clickId };
  }

  await upsertStripeCheckoutRecord({
    sessionId,
    userId: userId || existing?.userId || "",
    credits: existing?.credits ?? 0,
    priceEurCents: existing?.priceEurCents ?? stripeAmountCents,
    priceLabel: existing?.priceLabel ?? "Ontmoetjongens",
    clickId,
    clickflareSentAt: new Date().toISOString(),
    paidAt: existing?.paidAt ?? new Date().toISOString(),
  });

  return { sent: true, reason: "ok", clickId };
}
