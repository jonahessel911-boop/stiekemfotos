import { NextResponse } from "next/server";
import { getConversation } from "@/lib/server/conversations";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const conv = getConversation(id);
  if (!conv) {
    return NextResponse.json({ error: "Gesprek niet gevonden" }, { status: 404 });
  }
  return NextResponse.json({ conversation: conv });
}
