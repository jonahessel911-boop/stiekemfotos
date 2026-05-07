import { NextResponse } from "next/server";
import { getDbProfileById } from "@/lib/server/profilesDb";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const profile = await getDbProfileById(id);
  if (!profile) {
    return NextResponse.json({ error: "Profiel niet gevonden." }, { status: 404 });
  }
  return NextResponse.json({ profile });
}
