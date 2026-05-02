import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import path from "path";
import { convImageDir } from "@/lib/server/convImageStore";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; messageId: string }> }
) {
  const { id: conversationId, messageId } = await context.params;
  if (!conversationId || !messageId || messageId.includes("..") || messageId.includes("/")) {
    return NextResponse.json({ error: "Ongeldig" }, { status: 400 });
  }

  const dir = convImageDir(conversationId);
  for (const ext of ["jpg", "jpeg", "png"] as const) {
    const filePath = path.join(dir, `${messageId}.${ext}`);
    try {
      const buf = await readFile(filePath);
      const type = ext === "png" ? "image/png" : "image/jpeg";
      return new NextResponse(buf, {
        headers: {
          "Content-Type": type,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch {
      /* try next ext */
    }
  }

  return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
}
