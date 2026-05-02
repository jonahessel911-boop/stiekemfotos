import { NextResponse } from "next/server";
import { xaiTextToSpeech } from "@/lib/xai-voice-server";
import { textForExpressiveTts } from "@/lib/tts-nudge";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text?: string; language?: string };
    const text = String(body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "Tekst ontbreekt." }, { status: 400 });
    }
    const language = String(body.language ?? "auto").trim() || "auto";
    const buf = await xaiTextToSpeech(textForExpressiveTts(text), {
      language,
    });
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "TTS-fout" },
      { status: 502 }
    );
  }
}
