import type { UserRecord } from "@/lib/server/users";
import { isSupabaseProfilesEnabled } from "@/lib/server/profilesDb";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

/**
 * Houdt public.users in Supabase gelijk met app-user (o.a. na wachtwoordreset).
 * Upsert op id — zelfde UUID als in users.json/blob.
 */
export async function upsertAppUserToSupabaseUsers(user: UserRecord): Promise<void> {
  if (!isSupabaseProfilesEnabled()) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn(
      "[supabase users] skip: geen service-role client — zet SUPABASE_SERVICE_ROLE_KEY (en SUPABASE_URL), herstart `npm run dev`"
    );
    return;
  }

  const row = {
    id: user.id,
    email: user.email.trim().toLowerCase(),
    naam: user.naam,
    leeftijd: user.leeftijd,
    password_hash: user.passwordHash,
    discreet_akkoord: user.discreetAkkoord,
    voorwaarden_akkoord: user.voorwaardenAkkoord,
    email_verify_token: user.emailVerifyToken ?? null,
    email_verified_at: user.emailVerifiedAt ?? null,
    zoek_leeftijd_categorie: user.zoekLeeftijdCategorie ?? null,
    zoek_eigenschappen: user.zoekEigenschappen ?? null,
    geschatte_matches: user.geschatteMatches ?? null,
    engagement_slots: user.engagementSlots ?? null,
    reaction_nudges: user.reactionNudges ?? null,
    engagement_outbound_log: user.engagementOutboundLog ?? null,
    personal_facts: user.personalFacts ?? null,
    first_credit_purchase_at: user.firstCreditPurchaseAt ?? null,
    last_seen_at: user.lastSeenAt ?? null,
    created_at: user.createdAt,
    updated_at: new Date().toISOString(),
    ...(user.platformOnboardingCompletedAt !== undefined
      ? { platform_onboarding_completed_at: user.platformOnboardingCompletedAt }
      : {}),
  };

  const { error } = await supabase.from("users").upsert(row, { onConflict: "id" });

  if (error) {
    console.warn("[supabase users] upsert:", error.message);
  } else if (process.env.DEBUG_SUPABASE_SYNC === "1") {
    console.info(`[supabase users] upsert OK id=${user.id} email=${user.email}`);
  }
}
