import { NextResponse } from "next/server";
import { readLocalAnimationFile } from "@/lib/server/animationStore";
import type { AnimationKey } from "@/lib/server/animations";

export async function GET(
  _req: Request,
  context: { params: Promise<{ key: string }> }
) {
  const { key } = await context.params;
  if (key !== "gift_closed" && key !== "gift_open") {
    return NextResponse.json({ error: "Unknown animation key" }, { status: 404 });
  }
  const file = await readLocalAnimationFile(key as AnimationKey);
  if (!file) {
    return NextResponse.json({ error: "Animation file not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "no-store",
    },
  });
}

