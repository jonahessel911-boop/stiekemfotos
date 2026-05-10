import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  appendUserGiftMessage,
  flushInboxAutomationsForOwner,
  recordOwnerPolledConversation,
} from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified, touchUserSeen } from "@/lib/server/users";

export const maxDuration = 240;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om te chatten." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    await touchUserSeen(userId);
    await recordOwnerPolledConversation(id, userId);
    const body = (await req.json()) as { credits?: number; note?: string; packageLabel?: string };
    const credits = Number(body.credits ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      return NextResponse.json({ error: "Ongeldige gift credits." }, { status: 400 });
    }
    const giftMessage = await appendUserGiftMessage(
      id,
      credits,
      String(body.note ?? ""),
      String(body.packageLabel ?? ""),
      userId
    );
    await flushInboxAutomationsForOwner(userId);
    return NextResponse.json({ giftMessage });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 400 }
    );
  }
}
