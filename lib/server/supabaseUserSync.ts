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
  if (!supabase) return;

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
    personal_facts: user.personalFacts ?? null,
    first_credit_purchase_at: user.firstCreditPurchaseAt ?? null,
    last_seen_at: user.lastSeenAt ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("users").upsert(row, { onConflict: "id" });

  if (error) {
    console.warn("[supabase users] upsert:", error.message);
  }
}
