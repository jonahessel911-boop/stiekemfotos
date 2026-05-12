import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe, STRIPE_WEBHOOK_SECRET } from "@/lib/server/stripe";
import {
  getStripeCheckoutBySessionId,
  getUserTotalPaidCents,
  markStripeCheckoutPaid,
} from "@/lib/server/stripeCheckoutStore";
import { findUserById, markCreditPurchase } from "@/lib/server/users";
import { appendPurchaseThanksMessage } from "@/lib/server/conversations";
import { syncStripePaymentAndRecomputeRevenue } from "@/lib/server/stripeRevenueSupabase";
import {
  buildSvlTxidForUser,
  formatPayoutFromCents,
  sendSvlPostback,
  SVL_CONVERSION_TYPE,
} from "@/lib/clickflare-postback";

export async function POST(req: Request) {
  try {
    if (!STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET ontbreekt." }, { status: 500 });
    }
    const sig = (await headers()).get("stripe-signature");
    if (!sig) return NextResponse.json({ error: "Signatuur ontbreekt." }, { status: 400 });

    const body = await req.text();
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        await markStripeCheckoutPaid(session.id);
        const userId = String(session.metadata?.userId ?? "");
        if (userId) {
          await markCreditPurchase(userId);
          await appendPurchaseThanksMessage(userId);

          /**
           * Volgorde:
           *  1. Persist deze Stripe-betaling naar Supabase (`stripe_checkouts`) en
           *     herbereken `users.revenue_cents` zodat de LTV in de database wordt
           *     opgehoogd. Idempotent op `session.id`.
           *  2. Daarna pas de ClickFlare postback firen met de **vers berekende**
           *     totale revenue als payout.
           */
          let revenueCents = 0;
          try {
            const stripeAmountCents =
              typeof session.amount_total === "number" && Number.isFinite(session.amount_total)
                ? session.amount_total
                : 0;
            const stripeCurrency = (session.currency || "eur").toLowerCase();

            // Local blob record voor credits + priceLabel (Stripe levert geen credits-aantal terug).
            const localRecord = await getStripeCheckoutBySessionId(session.id);
            const credits = Number(
              localRecord?.credits ?? session.metadata?.credits ?? 0
            );
            const priceLabel =
              localRecord?.priceLabel ||
              (stripeAmountCents > 0
                ? `€${(stripeAmountCents / 100).toFixed(2).replace(".", ",")}`
                : "Stripe checkout");

            const syncResult = await syncStripePaymentAndRecomputeRevenue({
              sessionId: session.id,
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
                `[revenue] sync mislukt voor user=${userId} session=${session.id}: ${syncResult.error}`
              );
            }
          } catch (e) {
            console.warn(
              `[revenue] sync exception: ${e instanceof Error ? e.message : String(e)}`
            );
          }

          /**
           * ClickFlare postback met de vers-berekende totale revenue (LTV).
           * Fallback: lokale blob-som als de Supabase sync faalde.
           */
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
              console.log(
                `[clickflare:stripe_paid] skipped — user ${userId} has no click_id`
              );
            }
          } catch (e) {
            // Webhook mag NOOIT crashen op een tracker-fout.
            console.warn(
              `[clickflare:stripe_paid] unexpected error: ${e instanceof Error ? e.message : String(e)}`
            );
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
