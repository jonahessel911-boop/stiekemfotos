import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  appendUserMessagesAndReply,
  flushInboxAutomationsForOwner,
  recordOwnerPolledConversation,
  type UserMessagePayload,
} from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified, touchUserSeen } from "@/lib/server/users";
import { isXaiConfigErrorMessage } from "@/lib/xai-env";

/** Ruimte voor tot 120s typ-pauze + Grok/TTS (Vercel: pas aan naar plan-limiet). */
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
    const body = (await req.json()) as {
      content?: string;
      noCredits?: boolean;
      imageBase64?: string;
      imageMime?: string;
      /** Meerdere berichten achter elkaar → één Grok-reactie over alles. */
      items?: UserMessagePayload[];
    };

    let items: UserMessagePayload[];

    if (Array.isArray(body.items) && body.items.length > 0) {
      items = body.items.map((it) => ({
        text: it.text?.trim() ?? "",
        imageBase64: it.imageBase64?.trim(),
        imageMime: it.imageMime,
        replyToId: it.replyToId,
      }));
    } else {
      const text = body.content?.trim() ?? "";
      const imageBase64 = body.imageBase64?.trim();
      items = [{ text, imageBase64, imageMime: body.imageMime }];
    }

    if (items.some((it) => !it.text && !it.imageBase64)) {
      return NextResponse.json({ error: "Bericht is leeg" }, { status: 400 });
    }

    const result = await appendUserMessagesAndReply(id, items, {
      noCredits: body.noCredits === true,
      requesterUserId: userId,
    });

    await flushInboxAutomationsForOwner(userId);

    return NextResponse.json({
      ...result,
      userMessage: result.userMessages[0] ?? null,
      creditWall: result.creditWall === true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fout";
    const status = isXaiConfigErrorMessage(msg) ? 503 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
