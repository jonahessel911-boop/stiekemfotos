import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import {
  deleteAdminProfilePhoto,
  listAdminProfilePhotos,
  uploadAdminProfilePhoto,
} from "@/lib/server/adminProfilePhotos";

export const maxDuration = 60;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 12 * 1024 * 1024;

async function requireAdmin(): Promise<NextResponse | null> {
  const jar = await cookies();
  if (!parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

type RouteCtx = { params: Promise<{ profileId: string }> };

export async function GET(_req: Request, context: RouteCtx) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { profileId } = await context.params;
  const id = profileId?.trim();
  if (!id) {
    return NextResponse.json({ error: "profileId ontbreekt" }, { status: 400 });
  }

  try {
    const { photos, avatarUrl } = await listAdminProfilePhotos(id);
    return NextResponse.json({ photos, avatarUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Laden mislukt";
    const status = msg.includes("niet gevonden") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request, context: RouteCtx) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { profileId } = await context.params;
  const id = profileId?.trim();
  if (!id) {
    return NextResponse.json({ error: "profileId ontbreekt" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand (file)" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "Leeg bestand" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Max 12 MB" }, { status: 413 });
  }

  const mime = file.type || "image/jpeg";
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: "Alleen JPEG, PNG of WebP" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const photo = await uploadAdminProfilePhoto(id, buffer, mime);
    return NextResponse.json({ ok: true, photo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload mislukt";
    const status = msg.includes("niet gevonden") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: Request, context: RouteCtx) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { profileId } = await context.params;
  const id = profileId?.trim();
  if (!id) {
    return NextResponse.json({ error: "profileId ontbreekt" }, { status: 400 });
  }

  let mediaId = "";
  try {
    const body = (await req.json()) as { mediaId?: string };
    mediaId = String(body.mediaId ?? "").trim();
  } catch {
    /* leeg body */
  }
  if (!mediaId) {
    return NextResponse.json({ error: "mediaId ontbreekt" }, { status: 400 });
  }

  try {
    await deleteAdminProfilePhoto(id, mediaId);
    const { photos, avatarUrl } = await listAdminProfilePhotos(id);
    return NextResponse.json({ ok: true, photos, avatarUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Verwijderen mislukt";
    const status = msg.includes("niet gevonden") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
