import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseAdminCookieValue, ADMIN_SESSION_COOKIE_NAME } from "@/lib/server/adminAuth";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { isSupabaseProfilesEnabled } from "@/lib/server/profilesDb";

function supabaseProjectRefFromEnv(): string | null {
  const raw =
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const m = /^([^.]+)\.supabase\.co$/i.exec(u.hostname);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Admin-only: één testrij in public.users om Supabase service-role + schema te verifiëren.
 */
export async function POST() {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isSupabaseProfilesEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Geen Supabase-URL + key in env (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL + anon of service role).",
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Geen service-role client. Zet SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL) en herstart de dev-server.",
      },
      { status: 400 }
    );
  }

  const id = randomUUID();
  const stamp = Date.now();
  const email = `admin-test-${stamp}@stiekemefotos.internal`;
  const now = new Date().toISOString();
  /** Zelfde formaat als users.ts — niet bedoeld om mee in te loggen. */
  const dummyPasswordHash =
    "00000000000000000000000000000000:" +
    "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

  const row = {
    id,
    email,
    naam: "Test Admin Ping",
    leeftijd: 28,
    password_hash: dummyPasswordHash,
    discreet_akkoord: true,
    voorwaarden_akkoord: true,
    email_verify_token: null as string | null,
    email_verified_at: now,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase.from("users").insert(row).select("id, email").single();

  if (error) {
    console.error("[admin test-supabase-user]", error.message);
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        code: (error as { code?: string }).code,
      },
      { status: 500 }
    );
  }

  const projectRef = supabaseProjectRefFromEnv();
  console.info(
    `[admin test-supabase-user] insert OK ${data?.id} ${data?.email} (project ref: ${projectRef ?? "?"})`
  );
  return NextResponse.json({
    ok: true,
    message:
      "Rij staat in public.users — check Table Editor → schema public → tabel users (niet Authentication → Users).",
    user: data,
    supabaseProjectRef: projectRef,
  });
}
