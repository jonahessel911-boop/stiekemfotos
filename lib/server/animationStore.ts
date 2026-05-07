import { mkdir, readFile, writeFile, access } from "fs/promises";
import path from "path";
import { getDataDir } from "@/lib/server/store";
import type { AnimationKey } from "@/lib/server/animations";

function animationsDir(): string {
  return path.join(getDataDir(), "animations");
}

function extForMime(mime: string): "mp4" | "webm" {
  return mime.toLowerCase().includes("webm") ? "webm" : "mp4";
}

function filePathFor(key: AnimationKey, ext: "mp4" | "webm"): string {
  return path.join(animationsDir(), `${key}.${ext}`);
}

export async function saveLocalAnimationFile(
  key: AnimationKey,
  bytes: Buffer,
  mime: string
): Promise<{ publicUrl: string; mime: string }> {
  const ext = extForMime(mime);
  const dir = animationsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(filePathFor(key, ext), bytes);
  return {
    publicUrl: `/api/animations/file/${key}?v=${Date.now()}`,
    mime,
  };
}

export async function readLocalAnimationFile(
  key: AnimationKey
): Promise<{ data: Buffer; mime: string } | null> {
  const tries: Array<{ ext: "mp4" | "webm"; mime: string }> = [
    { ext: "mp4", mime: "video/mp4" },
    { ext: "webm", mime: "video/webm" },
  ];
  for (const t of tries) {
    const fp = filePathFor(key, t.ext);
    try {
      await access(fp);
      const data = await readFile(fp);
      return { data, mime: t.mime };
    } catch {
      // try next
    }
  }
  return null;
}

