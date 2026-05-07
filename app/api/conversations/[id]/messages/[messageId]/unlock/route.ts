import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  recordOwnerPolledConversation,
  unlockAssistantPhoto,
} from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified, touchUserSeen } from "@/lib/server/users";

export const maxDuration = 60;

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id, messageId } = await context.params;
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om foto's te ontgrendelen." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    await touchUserSeen(userId);
    await recordOwnerPolledConversation(id, userId);

    const result = await unlockAssistantPhoto(id, messageId, userId);
    return NextResponse.json({
      ok: true,
      alreadyUnlocked: result.alreadyUnlocked,
      creditsCost: result.creditsCost,
      unlockedMessage: result.unlockedMessage,
      followupMessage: result.followupMessage,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout bij ontgrendelen" },
      { status: 400 }
    );
  }
}
