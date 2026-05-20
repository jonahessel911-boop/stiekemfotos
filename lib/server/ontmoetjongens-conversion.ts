import {
  buildSvlTxidForUser,
  formatPayoutFromCents,
  sendSvlPostback,
  SVL_CONVERSION_TYPE,
} from "@/lib/clickflare-postback";
import {
  getStripe,
  ONTMOETJONGENS_ONBOARDING,
  STRIPE_PRODUCT_ONTMOETJONGENS,
} from "@/lib/server/stripe";
import { sendOntmoetjongensAccessEmailIfNeeded } from "@/lib/server/ontmoetjongens-access-email";
import { provisionOntmoetjongensUser } from "@/lib/server/ontmoetjongens-user";
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
  userId?: string | null;
  userCreated?: boolean;
};

/**
 * Na Ontmoetjongens-betaling: user aanmaken/koppelen + ClickFlare postback (idempotent).
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
  const clickflareAlreadySent = Boolean(existing?.clickflareSentAt);

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["customer"],
  });

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

  const provision = await provisionOntmoetjongensUser({
    sessionId,
    clickId,
    session,
  });
  const userId =
    provision.userId ||
    String(session.metadata?.userId ?? "").trim() ||
    existing?.userId ||
    "";

  if (userId) {
    await sendOntmoetjongensAccessEmailIfNeeded({
      sessionId,
      userId,
      session,
      stripeEmail: provision.email,
    });
  }

  const stripeAmountCents =
    typeof session.amount_total === "number" && Number.isFinite(session.amount_total)
      ? session.amount_total
      : existing?.priceEurCents ?? ONTMOETJONGENS_ONBOARDING.priceEurCents;

  const baseCheckout = {
    sessionId,
    userId,
    credits: existing?.credits ?? 0,
    priceEurCents: existing?.priceEurCents ?? stripeAmountCents,
    priceLabel: existing?.priceLabel ?? "€19,95 · Ontmoetjongens",
    clickId: clickId || existing?.clickId,
    paidAt: existing?.paidAt ?? new Date().toISOString(),
  };

  if (!clickId) {
    await upsertStripeCheckoutRecord(baseCheckout);
    console.warn(
      `[clickflare:ontmoetjongens_paid] session=${sessionId} — geen click_id; user=${userId || "geen"}`
    );
    return {
      sent: false,
      reason: "no_click_id",
      clickId: undefined,
      userId: userId || null,
      userCreated: provision.created,
    };
  }

  if (clickflareAlreadySent) {
    await upsertStripeCheckoutRecord(baseCheckout);
    return {
      sent: false,
      skipped: true,
      reason: "already_sent",
      clickId,
      userId: userId || null,
      userCreated: provision.created,
    };
  }

  const payout = formatPayoutFromCents(ONTMOETJONGENS_ONBOARDING.priceEurCents);

  const postback = await sendSvlPostback({
    clickId,
    payout,
    txid: userId ? buildSvlTxidForUser(userId) : `ontmoetjongens_${sessionId}`,
    ct: SVL_CONVERSION_TYPE,
    reason: "ontmoetjongens_paid",
  });

  if (!postback.fired || !postback.ok) {
    await upsertStripeCheckoutRecord(baseCheckout);
    console.warn(
      `[clickflare:ontmoetjongens_paid] postback mislukt session=${sessionId} status=${postback.status ?? "?"} err=${postback.error ?? ""}`
    );
    return {
      sent: false,
      reason: "postback_failed",
      clickId,
      userId: userId || null,
      userCreated: provision.created,
    };
  }

  await upsertStripeCheckoutRecord({
    ...baseCheckout,
    clickflareSentAt: new Date().toISOString(),
  });

  return {
    sent: true,
    reason: "ok",
    clickId,
    userId: userId || null,
    userCreated: provision.created,
  };
}
