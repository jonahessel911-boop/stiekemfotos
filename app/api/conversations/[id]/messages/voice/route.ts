import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  appendUserMessagesAndReply,
  recordOwnerPolledConversation,
} from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified, touchUserSeen } from "@/lib/server/users";
import { xaiSpeechToText } from "@/lib/xai-voice-server";
import { isXaiConfigErrorMessage } from "@/lib/xai-env";

export const maxDuration = 240;
export const runtime = "nodejs";

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

    const form = await req.formData();
    const audioFile = form.get("audio");
    const clientMessageId = String(form.get("clientMessageId") ?? "").trim();
    const fallbackText = String(form.get("fallbackText") ?? "").trim();
    if (!(audioFile instanceof File)) {
      return NextResponse.json({ error: "Audio ontbreekt." }, { status: 400 });
    }
    if (audioFile.size <= 0) {
      return NextResponse.json({ error: "Audio is leeg." }, { status: 400 });
    }
    if (audioFile.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "Audio is te groot (max 12MB)." }, { status: 400 });
    }

    const audioArrayBuffer = await audioFile.arrayBuffer();
    let transcript = "";
    try {
      transcript = await xaiSpeechToText(audioArrayBuffer, {
        mimeType: audioFile.type || "audio/webm",
        filename: audioFile.name || "voice.webm",
        language: String(form.get("language") ?? "nl"),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Team/ACL 403 op xAI STT: fallback naar browser transcriptie als beschikbaar.
      if (msg.includes("STT (403)") && fallbackText) {
        transcript = fallbackText;
      } else {
        throw e;
      }
    }

    const audioBuffer = Buffer.from(audioArrayBuffer);
    const audioBase64 = audioBuffer.toString("base64");
    const result = await appendUserMessagesAndReply(
      id,
      [
        {
          clientMessageId: clientMessageId || undefined,
          text: transcript,
          voiceAudioBase64: audioBase64,
          voiceMime: audioFile.type || "audio/webm",
        },
      ],
      { requesterUserId: userId }
    );

    return NextResponse.json({
      ...result,
      transcript,
      userMessage: result.userMessages[0] ?? null,
      creditWall: result.creditWall === true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fout";
    const status = isXaiConfigErrorMessage(msg) ? 503 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

