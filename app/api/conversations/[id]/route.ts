import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getConversation } from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified } from "@/lib/server/users";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const jar = await cookies();
  const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
  if (userId && !(await isUserEmailVerified(userId))) {
    return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
  }
  const conv = await getConversation(id, userId);
  if (!conv) {
    return NextResponse.json({ error: "Gesprek niet gevonden" }, { status: 404 });
  }
  return NextResponse.json({ conversation: conv });
}
