import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe, STRIPE_WEBHOOK_SECRET } from "@/lib/server/stripe";
import { markStripeCheckoutPaid } from "@/lib/server/stripeCheckoutStore";
import { markCreditPurchase } from "@/lib/server/users";

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
