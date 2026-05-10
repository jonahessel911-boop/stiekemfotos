import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { findUserById } from "@/lib/server/users";
import {
  CREDIT_PACKAGES,
  type CreditPackageId,
  getStripe,
  resolveReturnUrl,
} from "@/lib/server/stripe";
import { upsertStripeCheckoutRecord } from "@/lib/server/stripeCheckoutStore";

function withQuery(urlStr: string, params: Record<string, string>) {
  const u = new URL(urlStr);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

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
    const body = (await req.json()) as { packageId?: CreditPackageId; returnUrl?: string };
    const packageId = body.packageId;
    if (!packageId || !(packageId in CREDIT_PACKAGES)) {
      return NextResponse.json({ error: "Ongeldig pakket." }, { status: 400 });
    }
    const pkg = CREDIT_PACKAGES[packageId];
    const returnUrl = resolveReturnUrl(body.returnUrl);
    const successUrl = withQuery(returnUrl, {
      stripe_success: "1",
      session_id: "{CHECKOUT_SESSION_ID}",
    });
    const cancelUrl = withQuery(returnUrl, { stripe_canceled: "1" });

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      metadata: {
        userId,
        packageId,
        credits: String(pkg.credits),
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            product_data: {
              name: `${pkg.credits} credits (${pkg.title})`,
              description: "Credits voor chats op stiekemefotos.nl",
            },
            unit_amount: pkg.priceEurCents,
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    await upsertStripeCheckoutRecord({
      sessionId: session.id,
      userId,
      credits: pkg.credits,
      priceLabel: `€${(pkg.priceEurCents / 100).toFixed(2).replace(".", ",")} · ${pkg.credits} credits`,
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout maken mislukt." },
      { status: 400 }
    );
  }
}
