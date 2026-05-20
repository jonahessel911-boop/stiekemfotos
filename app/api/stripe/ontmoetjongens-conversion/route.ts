import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SVL_CLICK_ID_COOKIE } from "@/lib/clickflare-postback";
import { sendOntmoetjongensClickflareConversion } from "@/lib/server/ontmoetjongens-conversion";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { sessionId?: string; clickId?: string };
    const sessionId = String(body.sessionId ?? "").trim();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId ontbreekt." }, { status: 400 });
    }

    const jar = await cookies();
    const clickIdHint =
      (typeof body.clickId === "string" ? body.clickId.trim() : "") ||
      jar.get(SVL_CLICK_ID_COOKIE)?.value?.trim() ||
      "";

    const result = await sendOntmoetjongensClickflareConversion({
      sessionId,
      clickIdHint,
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Conversie mislukt." },
      { status: 400 }
    );
  }
}
