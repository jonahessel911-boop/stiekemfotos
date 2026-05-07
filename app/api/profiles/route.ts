import { NextResponse } from "next/server";
import { listDbProfiles, isSupabaseProfilesEnabled } from "@/lib/server/profilesDb";
import { allProfiles } from "@/lib/profiles";

export async function GET() {
  try {
    const dbProfiles = await listDbProfiles(100);
    if (dbProfiles.length > 0) {
      return NextResponse.json({ profiles: dbProfiles });
    }
    if (isSupabaseProfilesEnabled()) {
      return NextResponse.json({ profiles: [] });
    }
    return NextResponse.json({ profiles: allProfiles });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Profielen laden mislukt." },
      { status: 500 }
    );
  }
}
