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

  const filePath = path.join(convVoiceDir(conversationId), `${messageId}.mp3`);
  try {
    const buf = await readFile(filePath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }
}
