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

const VOICE_FALLBACK_EMOJIS = ["😏", "😈", "😜", "😘", "😮‍💨", "🥵", "🍑", "🍆", "💦", "❤️‍🔥"] as const;

function randomVoiceEmojiLine(): string {
  const count = 3 + Math.floor(Math.random() * 4); // 3..6 emojis
  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const emoji = VOICE_FALLBACK_EMOJIS[Math.floor(Math.random() * VOICE_FALLBACK_EMOJIS.length)];
    picked.push(emoji ?? "😏");
  }
  return picked.join(" ");
}

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
    const durationMsRaw = Number(form.get("durationMs"));
    const durationMs =
      Number.isFinite(durationMsRaw) && durationMsRaw >= 0
        ? Math.floor(durationMsRaw)
        : undefined;
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
      // Nooit blokken op transcriptie: gebruik browsertekst of emoji-fallback.
      if (fallbackText) {
        transcript = fallbackText;
      }
    }

    const transcriptForAi =
      transcript.trim() ||
      fallbackText ||
      randomVoiceEmojiLine();

    const audioBuffer = Buffer.from(audioArrayBuffer);
    const audioBase64 = audioBuffer.toString("base64");
    const result = await appendUserMessagesAndReply(
      id,
      [
        {
          clientMessageId: clientMessageId || undefined,
          text: transcriptForAi,
          voiceAudioBase64: audioBase64,
          voiceMime: audioFile.type || "audio/webm",
          voiceDurationMs: durationMs,
        },
      ],
      { requesterUserId: userId }
    );

    return NextResponse.json({
      ...result,
      transcript: transcriptForAi,
      userMessage: result.userMessages[0] ?? null,
      creditWall: result.creditWall === true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fout";
    const status = isXaiConfigErrorMessage(msg) ? 503 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

