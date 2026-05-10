import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { findUserById } from "@/lib/server/users";
import { upsertAppUserToSupabaseUsers } from "@/lib/server/supabaseUserSync";

/**
 * Zorgt dat er een rij in `public.users` bestaat voor foreign keys
 * (`conversations.owner_user_id`, `photo_requests.owner_user_id`, …).
 * Haalt de gebruiker uit de app-user store en upsert naar Supabase.
 */
export async function resolveUserIdForSupabaseFk(
  rawUserId: string | undefined
): Promise<string | null> {
  const id = rawUserId?.trim();
  if (!id) return null;

  const user = await findUserById(id);
  if (!user) {
    console.warn(`[ensureUserRowForFk] user ${id} niet in users-store — FK wordt null`);
    return null;
  }

  const admin = getSupabaseAdmin();
  if (!admin) return user.id;

  /** Bestaat de rij al → geen upsert (was: bij elke gesprek-save N× dezelfde upsert). */
  const { data: existing, error: selErr } = await admin
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (selErr) {
    console.warn(`[ensureUserRowForFk] verify Postgres user: ${selErr.message}`);
    return null;
  }
  if (existing?.id) {
    return user.id;
  }

  await upsertAppUserToSupabaseUsers(user);

  const { data, error } = await admin.from("users").select("id").eq("id", user.id).maybeSingle();
  if (error) {
    console.warn(`[ensureUserRowForFk] verify Postgres user: ${error.message}`);
    return null;
  }
  if (!data?.id) {
    console.warn(`[ensureUserRowForFk] user ${user.id} ontbreekt in Postgres na upsert`);
    return null;
  }
  return user.id;
}
