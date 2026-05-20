import { randomBytes } from "crypto";
import type Stripe from "stripe";
import { ONTMOETJONGENS_ONBOARDING, getStripe } from "@/lib/server/stripe";
import { syncStripePaymentAndRecomputeRevenue } from "@/lib/server/stripeRevenueSupabase";
import {
  createUser,
  findUserByEmail,
  findUserById,
  markOntmoetjongensPaidForUser,
} from "@/lib/server/users";

function randomPassword(): string {
  return randomBytes(24).toString("base64url");
}

function emailFromStripeSession(session: Stripe.Checkout.Session): string {
  const direct =
    session.customer_details?.email?.trim() ||
    session.customer_email?.trim() ||
    "";
  if (direct) return direct.toLowerCase();

  const customer = session.customer;
  if (customer && typeof customer === "object" && "email" in customer) {
    const em = (customer as Stripe.Customer).email?.trim();
    if (em) return em.toLowerCase();
  }
  return "";
}

function naamFromStripeSession(session: Stripe.Checkout.Session, email: string): string {
  const name = session.customer_details?.name?.trim();
  if (name) return name;
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "Lid";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

async function syncOntmoetjongensRevenue(
  session: Stripe.Checkout.Session,
  userId: string
): Promise<void> {
  const amountCents =
    typeof session.amount_total === "number" && Number.isFinite(session.amount_total)
      ? session.amount_total
      : ONTMOETJONGENS_ONBOARDING.priceEurCents;
  try {
    await syncStripePaymentAndRecomputeRevenue({
      sessionId: session.id,
      userId,
      amountCents,
      credits: 0,
      priceLabel: "€19,95 · Ontmoetjongens",
      currency: (session.currency || "eur").toLowerCase(),
      paidAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(
      `[ontmoetjongens] revenue sync mislukt user=${userId}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export type ProvisionOntmoetjongensUserResult = {
  userId: string | null;
  created: boolean;
  email: string | null;
};

/**
 * Maakt een app-user aan (of koppelt bestaande) na geslaagde Ontmoetjongens-betaling.
 */
export async function provisionOntmoetjongensUser(input: {
  sessionId: string;
  clickId?: string;
  session?: Stripe.Checkout.Session;
}): Promise<ProvisionOntmoetjongensUserResult> {
  const sessionId = input.sessionId.trim();
  const stripe = getStripe();
  const session =
    input.session ??
    (await stripe.checkout.sessions.retrieve(sessionId, { expand: ["customer"] }));

  const metaUserId = String(session.metadata?.userId ?? "").trim();
  if (metaUserId) {
    const existing = await findUserById(metaUserId);
    if (existing) {
      await markOntmoetjongensPaidForUser(existing.id);
      await syncOntmoetjongensRevenue(session, existing.id);
      return { userId: existing.id, created: false, email: existing.email };
    }
  }

  const email = emailFromStripeSession(session);
  if (!email) {
    console.warn(
      `[ontmoetjongens] session ${sessionId} — geen e-mail van Stripe, user niet aangemaakt`
    );
    return { userId: metaUserId || null, created: false, email: null };
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    await markOntmoetjongensPaidForUser(existing.id);
    await syncOntmoetjongensRevenue(session, existing.id);
    console.log(`[ontmoetjongens] bestaande user gekoppeld: ${existing.id} (${email})`);
    return { userId: existing.id, created: false, email };
  }

  try {
    const user = await createUser({
      email,
      naam: naamFromStripeSession(session, email),
      leeftijd: 35,
      password: randomPassword(),
      discreetAkkoord: true,
      voorwaardenAkkoord: true,
      ...(input.clickId?.trim() ? { clickId: input.clickId.trim() } : {}),
    });
    await markOntmoetjongensPaidForUser(user.id);
    await syncOntmoetjongensRevenue(session, user.id);
    console.log(`[ontmoetjongens] user aangemaakt: ${user.id} (${email})`);
    return { userId: user.id, created: true, email };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ontmoetjongens] createUser mislukt (${email}): ${msg}`);
    const again = await findUserByEmail(email);
    if (again) {
      await markOntmoetjongensPaidForUser(again.id);
      await syncOntmoetjongensRevenue(session, again.id);
      return { userId: again.id, created: false, email };
    }
    return { userId: null, created: false, email };
  }
}
