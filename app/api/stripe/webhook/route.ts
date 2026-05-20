import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  CREDIT_PACKAGES,
  type CreditPackageId,
  getStripe,
  STRIPE_PRODUCT_ONTMOETJONGENS,
  STRIPE_WEBHOOK_SECRET,
} from "@/lib/server/stripe";
import {
  getStripeCheckoutBySessionId,
  getUserTotalPaidCents,
  markStripeCheckoutPaid,
} from "@/lib/server/stripeCheckoutStore";
import { findUserById, markCreditPurchase } from "@/lib/server/users";
import { appendPurchaseThanksMessage } from "@/lib/server/conversations";
import { syncStripePaymentAndRecomputeRevenue } from "@/lib/server/stripeRevenueSupabase";
import { buildSvlTxidForUser, formatPayoutFromCents, sendSvlPostback, SVL_CONVERSION_TYPE } from "@/lib/clickflare-postback";
import { sendOntmoetjongensClickflareConversion } from "@/lib/server/ontmoetjongens-conversion";

/**
 * Na een succesvolle betaling (Checkout of PaymentIntent): blob `paidAt`,
 * Supabase revenue, ClickFlare. Idempotent op `sessionId` via upsert.
 */
async function handlePaidStripeCreditsOrder(input: {
  sessionId: string;
  userId: string;
  amountCents: number;
  currency: string;
  creditsHint?: string | null;
}): Promise<void> {
  await markStripeCheckoutPaid(input.sessionId);
  const userId = input.userId.trim();
  if (!userId) return;

  await markCreditPurchase(userId);
  await appendPurchaseThanksMessage(userId);

  let revenueCents = 0;
  try {
    const stripeAmountCents =
      typeof input.amountCents === "number" && Number.isFinite(input.amountCents)
        ? Math.max(0, Math.floor(input.amountCents))
        : 0;
    const stripeCurrency = (input.currency || "eur").toLowerCase();

    const localRecord = await getStripeCheckoutBySessionId(input.sessionId);
    const credits = Number(localRecord?.credits ?? input.creditsHint ?? 0);
    const priceLabel =
      localRecord?.priceLabel ||
      (stripeAmountCents > 0
        ? `€${(stripeAmountCents / 100).toFixed(2).replace(".", ",")}`
        : "Stripe checkout");

    const syncResult = await syncStripePaymentAndRecomputeRevenue({
      sessionId: input.sessionId,
      userId,
      amountCents: stripeAmountCents,
      credits,
      priceLabel,
      currency: stripeCurrency,
    });
    if (syncResult.ok) {
      revenueCents = syncResult.revenueCents;
    } else {
      console.warn(
        `[revenue] sync mislukt voor user=${userId} session=${input.sessionId}: ${syncResult.error}`
      );
    }
  } catch (e) {
    console.warn(`[revenue] sync exception: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const user = await findUserById(userId);
    const clickId = user?.clickId?.trim();
    if (clickId) {
      if (revenueCents <= 0) {
        revenueCents = await getUserTotalPaidCents(userId);
      }
      await sendSvlPostback({
        clickId,
        payout: formatPayoutFromCents(revenueCents),
        txid: buildSvlTxidForUser(userId),
        ct: SVL_CONVERSION_TYPE,
        reason: "stripe_paid",
      });
    } else {
      console.log(`[clickflare:stripe_paid] skipped — user ${userId} has no click_id`);
    }
  } catch (e) {
    console.warn(
      `[clickflare:stripe_paid] unexpected error: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const stripe = getStripe();
    const sig = (await headers()).get("stripe-signature");

    let event: Stripe.Event;
    if (STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(body) as Stripe.Event;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        const productType = String(session.metadata?.productType ?? "");
        const userId = String(session.metadata?.userId ?? "");
        const stripeAmountCents =
          typeof session.amount_total === "number" && Number.isFinite(session.amount_total)
            ? session.amount_total
            : 0;

        if (productType === STRIPE_PRODUCT_ONTMOETJONGENS) {
          await sendOntmoetjongensClickflareConversion({
            sessionId: session.id,
            clickIdHint: String(session.metadata?.clickId ?? "").trim(),
          });
        } else if (userId) {
          await handlePaidStripeCreditsOrder({
            sessionId: session.id,
            userId,
            amountCents: stripeAmountCents,
            currency: (session.currency || "eur").toLowerCase(),
            creditsHint: session.metadata?.credits ?? null,
          });
        }
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.flow === "prb_deal") {
        const pkgId = pi.metadata?.packageId as CreditPackageId | undefined;
        if (!pkgId || !(pkgId in CREDIT_PACKAGES)) {
          console.warn(`[stripe:prb] onbekend packageId in PI ${pi.id}`);
        } else {
          const expected = CREDIT_PACKAGES[pkgId].priceEurCents;
          if (pi.amount !== expected) {
            console.warn(
              `[stripe:prb] amount mismatch PI=${pi.id} got=${pi.amount} expected=${expected}`
            );
          } else {
            const amountReceived =
              typeof pi.amount_received === "number" && Number.isFinite(pi.amount_received)
                ? pi.amount_received
                : pi.amount;
            await handlePaidStripeCreditsOrder({
              sessionId: pi.id,
              userId: String(pi.metadata?.userId ?? ""),
              amountCents: amountReceived,
              currency: (pi.currency || "eur").toLowerCase(),
              creditsHint: pi.metadata?.credits ?? null,
            });
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Webhook fout" },
      { status: 400 }
    );
  }
}
