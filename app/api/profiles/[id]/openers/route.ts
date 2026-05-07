import { NextResponse } from "next/server";
import { getDbProfileById } from "@/lib/server/profilesDb";
import { buildProfileOpeners } from "@/lib/profile-openers";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const profile = await getDbProfileById(id);
    if (!profile) {
      return NextResponse.json({ error: "Profiel niet gevonden" }, { status: 404 });
    }
    const openers = buildProfileOpeners(profile);
    return NextResponse.json({ openers });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
