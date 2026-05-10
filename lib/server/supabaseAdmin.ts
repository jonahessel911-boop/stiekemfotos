import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Alleen gezet als client succesvol is gebouwd — nooit `null` cachen (anders blijft env na fix dood tot harde restart). */
let cachedAdmin: SupabaseClient | undefined;

let warnedMissingEnv = false;

/** Trim + verwijder per ongeluk geplakte aanhalingstekens rond secrets in Vercel/.env. */
export function stripEnvSecret(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function resolveServiceRoleKey(): string {
  return stripEnvSecret(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  );
}

function normalizeSupabaseUrl(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return v.replace(/^https?:\/\/https?:\/\//i, "https://");
}

/**
 * Service-role client (RLS bypass). Vereist SUPABASE_SERVICE_ROLE_KEY + project-URL.
 * Herleest env bij elke mislukte poging tot de client een keer gebouwd is (geen permanente null-cache).
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;

  const url = normalizeSupabaseUrl(
    stripEnvSecret(process.env.SUPABASE_URL) ||
      stripEnvSecret(process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
  const key = resolveServiceRoleKey();

  if (!url || !key) {
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      console.warn(
        "[supabaseAdmin] Service role niet beschikbaar — server valt terug op anon (RLS kan reads blokkeren):",
        [!url && "SUPABASE_URL (of NEXT_PUBLIC_SUPABASE_URL)", !key && "SUPABASE_SERVICE_ROLE_KEY"]
          .filter(Boolean)
          .join(", ") || "(onbekend)"
      );
    }
    return null;
  }

  cachedAdmin = createClient(url, key, { auth: { persistSession: false } });
  return cachedAdmin;
}
