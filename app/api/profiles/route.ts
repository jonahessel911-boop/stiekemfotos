import { NextResponse } from "next/server";
import { listDbProfiles } from "@/lib/server/profilesDb";

export async function GET() {
  try {
    const profiles = await listDbProfiles(100);
    return NextResponse.json({ profiles });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Profielen laden mislukt." },
      { status: 500 }
    );
  }
}
