import { NextResponse } from "next/server";
import { getAnimationUrl, type AnimationKey } from "@/lib/server/animations";

export async function GET(
  _req: Request,
  context: { params: Promise<{ key: string }> }
) {
  const { key } = await context.params;
  if (key !== "gift_closed" && key !== "gift_open") {
    return NextResponse.json({ error: "Unknown animation key" }, { status: 404 });
  }
  const url = await getAnimationUrl(key as AnimationKey);
  return NextResponse.json({ key, url: url ?? null });
}

