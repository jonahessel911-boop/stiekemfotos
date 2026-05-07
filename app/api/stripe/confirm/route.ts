import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { getStripe } from "@/lib/server/stripe";
import {
  consumeStripeCheckoutForUser,
  markStripeCheckoutPaid,
} from "@/lib/server/stripeCheckoutStore";

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in vereist." }, { status: 401 });
    }
    const body = (await req.json()) as { sessionId?: string };
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) return NextResponse.json({ error: "sessionId ontbreekt." }, { status: 400 });

    const stripe = getStripe();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (s.payment_status !== "paid") {
      return NextResponse.json({ error: "Betaling nog niet bevestigd." }, { status: 400 });
    }
    await markStripeCheckoutPaid(sessionId);

    const consumed = await consumeStripeCheckoutForUser(sessionId, userId);
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
