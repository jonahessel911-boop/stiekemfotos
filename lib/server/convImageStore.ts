import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getDataDir } from "@/lib/server/store";

export function convImageDir(conversationId: string): string {
  return path.join(getDataDir(), "conv-images", conversationId);
}

/** Schrijft raw bytes; retourneert bestandsnaam (alleen naam, geen pad). */
export async function saveConversationImage(
  conversationId: string,
  messageId: string,
  buffer: Buffer,
  mime: string
): Promise<string> {
  const ext = mime.includes("png") ? "png" : "jpg";
  const filename = `${messageId}.${ext}`;
  const dir = convImageDir(conversationId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);
  return filename;
}

export function convImageAbsolutePath(conversationId: string, filename: string): string {
  return path.join(convImageDir(conversationId), filename);
}

export function convVoiceDir(conversationId: string): string {
  return path.join(getDataDir(), "conv-voice", conversationId);
}

/** Schrijft MP3-bytes; retourneert bestandsnaam (alleen naam, geen pad). */
export async function saveConversationVoice(
  conversationId: string,
  messageId: string,
  buffer: Buffer
): Promise<string> {
  const filename = `${messageId}.mp3`;
  const dir = convVoiceDir(conversationId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);
  return filename;
}

/** Bewaart user-voice input in originele mime-extensie voor STT/debugging. */
export async function saveConversationVoiceInput(
  conversationId: string,
  messageId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const m = (mimeType || "").toLowerCase();
  const ext = m.includes("wav")
    ? "wav"
    : m.includes("mpeg") || m.includes("mp3")
      ? "mp3"
      : m.includes("ogg")
        ? "ogg"
        : "webm";
  const filename = `${messageId}.${ext}`;
  const dir = convVoiceDir(conversationId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), buffer);
  return filename;
}
