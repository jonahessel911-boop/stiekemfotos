import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createSessionValue,
  parseSessionValue,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/server/session";
import { findUserById, persistClickIdOnUser } from "@/lib/server/users";
import { processDueAbandonmentOfferEmails } from "@/lib/server/abandonmentOffer";
import { registerStartLead } from "@/lib/server/startLead";
import {
  getStripe,
  ONTMOETJONGENS_ONBOARDING,
  resolveReturnUrl,
  STRIPE_PRODUCT_ONTMOETJONGENS,
  STRIPE_PRODUCT_ONTMOETJONGENS_KORTING,
} from "@/lib/server/stripe";
import {
  KORTING_DISCOUNT_PERCENT,
  KORTING_PRICE_EUR_CENTS,
  KORTING_REFERENCE_LABEL,
  KORTING_PRICE_LABEL,
} from "@/lib/korting-offer";
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
    const body = (await req.json()) as {
      returnUrl?: string;
      clickId?: string;
      email?: string;
    };
    const jar = await cookies();
    let userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    const clickId =
      (typeof body.clickId === "string" ? body.clickId.trim() : "") ||
      jar.get(SVL_CLICK_ID_COOKIE)?.value?.trim() ||
      "";

    let customerEmail: string | undefined;
    if (userId) {
      const user = await findUserById(userId);
      customerEmail = user?.email;
      if (clickId) await persistClickIdOnUser(userId, clickId);
    }

    let setSessionUserId: string | null = null;
    const bodyEmail = typeof body.email === "string" ? body.email.trim() : "";
    if (!userId && bodyEmail) {
      const { user } = await registerStartLead({
        email: bodyEmail,
        startPath: "/korting",
        clickId,
      });
      userId = user.id;
      customerEmail = user.email;
      setSessionUserId = user.id;
      if (clickId) await persistClickIdOnUser(userId, clickId);
    }

    if (!customerEmail && bodyEmail) {
      customerEmail = bodyEmail.toLowerCase();
    }

    const baseReturn = resolveReturnUrl(body.returnUrl ?? undefined);
    const successUrl = appendStripeSessionPlaceholder(
      withQuery(baseReturn, { ontmoetjongens_paid: "1" })
    );
    const cancelUrl = withQuery(baseReturn, { ontmoetjongens_canceled: "1" });

    void processDueAbandonmentOfferEmails().catch(() => {});

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      billing_address_collection: "auto",
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      metadata: {
        productType: STRIPE_PRODUCT_ONTMOETJONGENS_KORTING,
        userId: userId ?? "",
        clickId,
        discountPercent: String(KORTING_DISCOUNT_PERCENT),
      },
      payment_intent_data: {
        metadata: {
          productType: STRIPE_PRODUCT_ONTMOETJONGENS_KORTING,
          userId: userId ?? "",
          clickId,
        },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            product_data: {
              name: `${ONTMOETJONGENS_ONBOARDING.title} (${KORTING_DISCOUNT_PERCENT}% korting)`,
              description: `Platformtoegang — was ${KORTING_REFERENCE_LABEL}, nu ${KORTING_PRICE_LABEL}`,
            },
            unit_amount: KORTING_PRICE_EUR_CENTS,
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
      priceEurCents: KORTING_PRICE_EUR_CENTS,
      priceLabel: `${KORTING_PRICE_LABEL} (${KORTING_DISCOUNT_PERCENT}% korting)`,
      clickId: clickId || undefined,
    });

    const res = NextResponse.json({ url: session.url, sessionId: session.id });
    if (setSessionUserId) {
      res.cookies.set(SESSION_COOKIE_NAME, createSessionValue(setSessionUserId), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });
    }
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout maken mislukt." },
      { status: 400 }
    );
  }
}
