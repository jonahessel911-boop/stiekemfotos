import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";
import { convVoiceDir } from "@/lib/server/convImageStore";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id: conversationId, messageId } = await context.params;
  if (!conversationId || !messageId || messageId.includes("..") || messageId.includes("/")) {
    return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  }

  const candidates: Array<{ filename: string; mime: string }> = [
    { filename: `${messageId}.mp3`, mime: "audio/mpeg" },
    { filename: `${messageId}.webm`, mime: "audio/webm" },
    { filename: `${messageId}.wav`, mime: "audio/wav" },
    { filename: `${messageId}.ogg`, mime: "audio/ogg" },
  ];
  for (const c of candidates) {
    try {
      const buf = await readFile(path.join(convVoiceDir(conversationId), c.filename));
      return new NextResponse(buf, {
        headers: {
          "Content-Type": c.mime,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      // try next extension
    }
  }
  return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
}
