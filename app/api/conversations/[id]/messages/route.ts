import { NextResponse } from "next/server";
import { appendUserMessagesAndReply, type UserMessagePayload } from "@/lib/server/conversations";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
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
    });

    return NextResponse.json({
      ...result,
      userMessage: result.userMessages[0],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fout";
    const status = msg.includes("XAI_API_KEY") ? 503 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
