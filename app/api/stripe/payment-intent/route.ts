import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { findUserById } from "@/lib/server/users";
import {
  CREDIT_PACKAGES,
  type CreditPackageId,
  getStripe,
} from "@/lib/server/stripe";
import { upsertStripeCheckoutRecord } from "@/lib/server/stripeCheckoutStore";

const WALLET_DEAL_PACKAGE: CreditPackageId = "left";

/**
 * Maakt een PaymentIntent voor Apple Pay / Google Pay (Payment Request Button)
 * op de deal-pagina. Alleen het `left`-pakket (100 credits / €13,95).
 */
export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om af te rekenen." }, { status: 401 });
    }
    const user = await findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "Gebruiker niet gevonden." }, { status: 401 });
    }
    const body = (await req.json()) as { packageId?: CreditPackageId };
    const packageId = body.packageId ?? WALLET_DEAL_PACKAGE;
    if (packageId !== WALLET_DEAL_PACKAGE || !(packageId in CREDIT_PACKAGES)) {
      return NextResponse.json(
        { error: "Alleen de speciale deal is via Apple Pay / Google Pay beschikbaar." },
        { status: 400 }
      );
    }
    const pkg = CREDIT_PACKAGES[packageId];
    const stripe = getStripe();
    const priceLabel = `€${(pkg.priceEurCents / 100).toFixed(2).replace(".", ",")} · ${pkg.credits} credits`;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: pkg.priceEurCents,
      currency: "eur",
      automatic_payment_methods: { enabled: true },
      receipt_email: user.email || undefined,
      description: `${pkg.credits} credits — stiekemefotos.nl`,
      metadata: {
        userId,
        packageId,
        credits: String(pkg.credits),
        flow: "prb_deal",
      },
    });

    if (!paymentIntent.client_secret) {
      return NextResponse.json({ error: "Geen client secret ontvangen van Stripe." }, { status: 500 });
    }

    await upsertStripeCheckoutRecord({
      sessionId: paymentIntent.id,
      userId,
      credits: pkg.credits,
      priceEurCents: pkg.priceEurCents,
      priceLabel,
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amountCents: pkg.priceEurCents,
      currency: "eur",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PaymentIntent maken mislukt." },
      { status: 400 }
    );
  }
}
