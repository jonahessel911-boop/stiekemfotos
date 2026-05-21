import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { findUserById } from "@/lib/server/users";
import { getStripe, resolveReturnUrl } from "@/lib/server/stripe";
import { resolveStripeCreditPackage } from "@/lib/server/resolveCreditPackage";
import { upsertStripeCheckoutRecord } from "@/lib/server/stripeCheckoutStore";

function withQuery(urlStr: string, params: Record<string, string>) {
  const u = new URL(urlStr);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Voegt `session_id={CHECKOUT_SESSION_ID}` toe aan een URL ZONDER URL-encoding
 * van de `{` / `}` tekens. Stripe vervangt de placeholder alleen als hij
 * letterlijk in de URL staat — `URLSearchParams.set` encodeert hem naar
 * `%7B...%7D` en breekt daarmee de substitutie.
 */
function appendStripeSessionPlaceholder(urlStr: string): string {
  const sep = urlStr.includes("?") ? "&" : "?";
  return `${urlStr}${sep}session_id={CHECKOUT_SESSION_ID}`;
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
    const body = (await req.json()) as { packageId?: string; returnUrl?: string };
    const packageId = String(body.packageId ?? "").trim();
    const pkg = resolveStripeCreditPackage(packageId);
    if (!pkg) {
      return NextResponse.json({ error: "Ongeldig pakket." }, { status: 400 });
    }
    const returnUrl = resolveReturnUrl(body.returnUrl);
    const successUrl = appendStripeSessionPlaceholder(
      withQuery(returnUrl, { stripe_success: "1" })
    );
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
              name: `${pkg.credits} credits`,
              description: "Credits voor chatten en foto's op stiekemefotos.nl",
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
      priceEurCents: pkg.priceEurCents,
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
