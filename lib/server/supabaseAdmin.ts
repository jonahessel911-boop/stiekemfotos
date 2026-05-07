import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * Eén gedeelde service-role client per serverproces (geen nieuwe client bij elke blob/query).
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
