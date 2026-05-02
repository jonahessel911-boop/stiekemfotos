import { mkdir, writeFile } from "fs/promises";
import path from "path";

const ROOT = path.join(process.cwd(), "data", "conv-images");

export function convImageDir(conversationId: string): string {
  return path.join(ROOT, conversationId);
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
