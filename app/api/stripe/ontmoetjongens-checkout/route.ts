import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { findUserById } from "@/lib/server/users";
import {
  getStripe,
  ONTMOETJONGENS_ONBOARDING,
  resolveReturnUrl,
  STRIPE_PRODUCT_ONTMOETJONGENS,
  SITE_URL,
} from "@/lib/server/stripe";
import { upsertStripeCheckoutRecord } from "@/lib/server/stripeCheckoutStore";
import { SVL_CLICK_ID_COOKIE } from "@/lib/clickflare-postback";

function withQuery(urlStr: string, params: Record<string, string>) {
  const u = new URL(urlStr);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

function appendStripeSessionPlaceholder(urlStr: string): string {
  const sep = urlStr.includes("?") ? "&" : "?";
  return `${urlStr}${sep}session_id={CHECKOUT_SESSION_ID}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { returnUrl?: string };
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    const clickId = jar.get(SVL_CLICK_ID_COOKIE)?.value?.trim() ?? "";

    let customerEmail: string | undefined;
    if (userId) {
      const user = await findUserById(userId);
      customerEmail = user?.email;
    }

    const baseReturn = resolveReturnUrl(body.returnUrl ?? `${SITE_URL}/start`);
    const successUrl = appendStripeSessionPlaceholder(
      withQuery(baseReturn, { ontmoetjongens_paid: "1" })
    );
    const cancelUrl = withQuery(baseReturn, { ontmoetjongens_canceled: "1" });

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      metadata: {
        productType: STRIPE_PRODUCT_ONTMOETJONGENS,
        userId: userId ?? "",
        clickId,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            product_data: {
              name: ONTMOETJONGENS_ONBOARDING.title,
              description: ONTMOETJONGENS_ONBOARDING.description,
            },
            unit_amount: ONTMOETJONGENS_ONBOARDING.priceEurCents,
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    await upsertStripeCheckoutRecord({
      sessionId: session.id,
      userId: userId ?? "",
      credits: 0,
      priceEurCents: ONTMOETJONGENS_ONBOARDING.priceEurCents,
      priceLabel: `€${(ONTMOETJONGENS_ONBOARDING.priceEurCents / 100).toFixed(2).replace(".", ",")} · Ontmoetjongens`,
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout maken mislukt." },
      { status: 400 }
    );
  }
}
