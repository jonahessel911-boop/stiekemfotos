import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { getStripe } from "@/lib/server/stripe";
import {
  consumeStripeCheckoutForUser,
  markStripeCheckoutPaid,
} from "@/lib/server/stripeCheckoutStore";

/**
 * Na een geslaagde Apple Pay / Google Pay-betaling: markeer checkout betaald
 * (idempotent) en verbruik de blob-record zodat de client credits kan toevoegen.
 * Zelfde patroon als `/api/stripe/confirm` voor Checkout-sessies.
 */
export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in vereist." }, { status: 401 });
    }
    const body = (await req.json()) as { paymentIntentId?: string };
    const paymentIntentId = String(body.paymentIntentId ?? "").trim();
    if (!paymentIntentId) {
      return NextResponse.json({ error: "paymentIntentId ontbreekt." }, { status: 400 });
    }

    const stripe = getStripe();
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (String(pi.metadata?.userId ?? "") !== userId) {
      return NextResponse.json({ error: "Transactie hoort niet bij dit account." }, { status: 403 });
    }
    if (pi.status !== "succeeded") {
      return NextResponse.json(
        { error: "Betaling nog niet bevestigd.", status: pi.status },
        { status: 409 }
      );
    }

    await markStripeCheckoutPaid(paymentIntentId);

    const consumed = await consumeStripeCheckoutForUser(paymentIntentId, userId);
    if (!consumed) {
      return NextResponse.json({ error: "Transactie niet gevonden." }, { status: 404 });
    }
    if (consumed.status === "not_ready") {
      return NextResponse.json({ error: "Betaling wordt nog verwerkt." }, { status: 409 });
    }
    if (consumed.status === "already_fulfilled") {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    return NextResponse.json({
      ok: true,
      credits: consumed.credits,
      priceLabel: consumed.priceLabel,
      alreadyProcessed: false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bevestigen mislukt." },
      { status: 400 }
    );
  }
}
