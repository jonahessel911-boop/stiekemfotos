import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, parseSessionValue } from "@/lib/server/session";
import { isUserEmailVerified } from "@/lib/server/users";
import { listProfilePortfolioItems } from "@/lib/server/conversations";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: profileId } = await context.params;
  const jar = await cookies();
  const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Log in om portfolio te bekijken." }, { status: 401 });
  }
  if (!(await isUserEmailVerified(userId))) {
    return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
  }
  const items = await listProfilePortfolioItems(profileId, userId, 30);
  return NextResponse.json({
    items: items.map((it) => ({
      ...it,
      imageUrl: `/api/conversations/${it.conversationId}/image/${it.messageId}`,
    })),
  });
}
