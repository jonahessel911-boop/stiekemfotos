import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { put } from "@vercel/blob";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { upsertAnimationUrl, type AnimationKey } from "@/lib/server/animations";
import { saveLocalAnimationFile } from "@/lib/server/animationStore";

export const maxDuration = 60;

export async function POST(
  req: Request,
  context: { params: Promise<{}> }
) {
  void context;
  const jar = await cookies();
  const raw = jar.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!parseAdminCookieValue(raw)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const keyRaw = String(form.get("key") ?? "").trim();
  if (keyRaw !== "gift_closed" && keyRaw !== "gift_open") {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  const key = keyRaw as AnimationKey;

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const mime = file.type || "video/mp4";
  const sizeBytes = file.size;
  if (sizeBytes <= 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (sizeBytes > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Max 25MB" }, { status: 413 });
  }

  try {
    const pathname = `stiekemefotos/animations/${key}`;
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: mime,
    });
    await upsertAnimationUrl({ key, url: blob.url, mime, sizeBytes });
    return NextResponse.json({ ok: true, key, url: blob.url, storage: "blob" });
  } catch (err) {
    // Local/dev fallback when Vercel Blob token is missing.
    const bytes = Buffer.from(await file.arrayBuffer());
    const local = await saveLocalAnimationFile(key, bytes, mime);
    await upsertAnimationUrl({ key, url: local.publicUrl, mime, sizeBytes });
    return NextResponse.json({
      ok: true,
      key,
      url: local.publicUrl,
      storage: "local",
      warning:
        err instanceof Error
          ? `Blob upload failed, saved locally instead: ${err.message}`
          : "Blob upload failed, saved locally instead",
    });
  }
}

