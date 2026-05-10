import { NextResponse } from "next/server";
import { isSupabaseProfilesEnabled, listDbProfiles } from "@/lib/server/profilesDb";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const vercelEnv = process.env.VERCEL_ENV ?? "";
  const configured = isSupabaseProfilesEnabled();
  const serviceRole = Boolean(getSupabaseAdmin());

  if (!configured) {
    return NextResponse.json({
      profiles: [],
      meta: {
        configured: false as const,
        vercelEnv: vercelEnv || undefined,
        serviceRole: false as const,
        hint: "supabase_env_missing" as const,
      },
    });
  }

  try {
    const profiles = await listDbProfiles(100);
    let hint: "empty_database" | "empty_uncertain" | undefined;
    if (profiles.length === 0) {
      /** Met service role is een lege lijst echt geen rijen; met alleen anon kan het RLS óf lege DB zijn. */
      hint = serviceRole ? "empty_database" : "empty_uncertain";
    }
    return NextResponse.json({
      profiles,
      meta: {
        configured: true as const,
        count: profiles.length,
        vercelEnv: vercelEnv || undefined,
        serviceRole,
        hint,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        profiles: [],
        error: e instanceof Error ? e.message : "Profielen laden mislukt.",
        meta: {
          configured: true as const,
          vercelEnv: vercelEnv || undefined,
          serviceRole,
        },
      },
      { status: 500 }
    );
  }
}
