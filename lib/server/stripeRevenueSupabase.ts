import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { resolveUserIdForSupabaseFk } from "@/lib/server/ensureUserRowForFk";

/**
 * Sync van een Stripe-betaling naar Postgres + bijgewerkte revenue per user.
 *
 * Idempotent: Stripe stuurt het webhook event soms meer dan eens met dezelfde
 * `session_id`. De UPSERT op `session_id` zorgt dat we niet dubbeltellen, en
 * `revenue_cents` wordt altijd opnieuw berekend als de SOM van alle betaalde
 * checkouts (i.p.v. + amount_cents), zodat herhaling veilig is.
 *
 * Schema-vereisten (zie supabase/add-users-revenue.sql):
 *  - public.stripe_checkouts.amount_cents (int)
 *  - public.stripe_checkouts.currency     (text)
 *  - public.users.revenue_cents           (bigint)
 *  - public.users.last_payment_at         (timestamptz)
 */
export type SyncStripePaymentInput = {
  sessionId: string;
  userId: string;
  amountCents: number;
  credits: number;
  priceLabel: string;
  currency?: string;
  paidAt?: string;
};

export type SyncStripePaymentResult =
  | { ok: true; revenueCents: number }
  | { ok: false; revenueCents: number; error: string };

export async function syncStripePaymentAndRecomputeRevenue(
  input: SyncStripePaymentInput
): Promise<SyncStripePaymentResult> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return {
      ok: false,
      revenueCents: 0,
      error: "Supabase admin client niet beschikbaar (service-role key ontbreekt)",
    };
  }
  const userFk = await resolveUserIdForSupabaseFk(input.userId);
  if (!userFk) {
    return {
      ok: false,
      revenueCents: 0,
      error: `User ${input.userId} kon niet naar Supabase FK omgezet worden`,
    };
  }
  const paidAt = input.paidAt || new Date().toISOString();
  const amountCents = Math.max(0, Math.floor(input.amountCents || 0));
  const currency = (input.currency || "eur").toLowerCase();

  /**
   * 1. UPSERT van deze checkout-row (idempotent op session_id PK).
   *    Hierdoor staat per Stripe-betaling het exacte bedrag persistent in
   *    Postgres en groeit de cumulatieve som automatisch.
   */
  const { error: upsertErr } = await admin.from("stripe_checkouts").upsert(
    {
      session_id: input.sessionId,
      user_id: userFk,
      credits: input.credits,
      price_label: input.priceLabel,
      amount_cents: amountCents,
      currency,
      paid_at: paidAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id" }
  );
  if (upsertErr) {
    console.warn(
      `[revenue] stripe_checkouts upsert fout session=${input.sessionId}: ${upsertErr.message}`
    );
    return { ok: false, revenueCents: 0, error: upsertErr.message };
  }

  /**
   * 2. Bereken totale revenue als som van alle paid checkouts voor deze user.
   *    Veilig bij hervoer van hetzelfde event (geen dubbeltelling).
   *    Werkt ook als de trigger uit add-users-revenue.sql nog niet draait —
   *    we updaten users.revenue_cents hier expliciet vanuit TS.
   */
  const { data: rows, error: sumErr } = await admin
    .from("stripe_checkouts")
    .select("amount_cents,paid_at")
    .eq("user_id", userFk)
    .not("paid_at", "is", null);
  if (sumErr) {
    console.warn(
      `[revenue] revenue sum query fout user=${userFk}: ${sumErr.message}`
    );
    return { ok: false, revenueCents: 0, error: sumErr.message };
  }
  let totalCents = 0;
  let lastPaidAt: string | null = null;
  for (const raw of rows ?? []) {
    const r = raw as { amount_cents: number | null; paid_at: string | null };
    if (typeof r.amount_cents === "number" && Number.isFinite(r.amount_cents)) {
      totalCents += Math.max(0, Math.floor(r.amount_cents));
    }
    if (r.paid_at && (!lastPaidAt || r.paid_at > lastPaidAt)) {
      lastPaidAt = r.paid_at;
    }
  }

  /**
   * 3. Schrijf de geüpdatete revenue naar de user-row.
   *    Idempotent: zelfde input → zelfde output. Als de SQL trigger ook
   *    draait, schrijft die dezelfde waarde — harmless.
   */
  const { error: userErr } = await admin
    .from("users")
    .update({
      revenue_cents: totalCents,
      revenue_currency: currency,
      last_payment_at: lastPaidAt ?? paidAt,
    })
    .eq("id", userFk);
  if (userErr) {
    console.warn(
      `[revenue] users.revenue_cents update fout user=${userFk}: ${userErr.message}`
    );
    return { ok: false, revenueCents: totalCents, error: userErr.message };
  }

  console.log(
    `[revenue] user=${userFk} session=${input.sessionId} +${amountCents}c → total=${totalCents}c`
  );
  return { ok: true, revenueCents: totalCents };
}
