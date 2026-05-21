import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { tryUploadImageToStorage } from "@/lib/server/imageStorage";
import { findUserById, patchUserRecord, toUserMyProfile } from "@/lib/server/users";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);

export async function POST(req: Request) {
  const jar = await cookies();
  const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Log in om een foto te uploaden." }, { status: 401 });
  }

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "Account niet gevonden." }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Kies een foto (jpg, png of webp)." }, { status: 400 });
  }

  const mime = (file.type || "image/jpeg").toLowerCase();
  if (!ALLOWED.has(mime)) {
    return NextResponse.json({ error: "Alleen JPG, PNG of WebP." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Foto max. 5 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await tryUploadImageToStorage({
    pathSegments: ["user-profiles", userId, "avatar"],
    buffer,
    mime,
    upsert: true,
  });

  if (!uploaded?.publicUrl) {
    return NextResponse.json(
      {
        error:
          "Upload mislukt. Controleer Supabase Storage (profile-media bucket) op deze omgeving.",
      },
      { status: 503 }
    );
  }

  const updated = await patchUserRecord(userId, { profilePhotoUrl: uploaded.publicUrl });
  if (!updated) {
    return NextResponse.json({ error: "Profiel bijwerken mislukt." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profilePhotoUrl: uploaded.publicUrl,
    profile: toUserMyProfile(updated),
  });
}
