import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { getGalleryPrefsForUser, upsertGalleryPrefsForUser } from "@/lib/server/galleryPrefs";

export async function GET() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
    }
    const prefs = await getGalleryPrefsForUser(userId);
    return NextResponse.json(prefs);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Kon voorkeuren niet laden." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
    }
    const body = (await req.json()) as {
      folders?: unknown;
      folderMap?: unknown;
    };
    const foldersIn = body.folders;
    const mapIn = body.folderMap;
    const folders = Array.isArray(foldersIn)
      ? foldersIn.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    const folderMap =
      mapIn && typeof mapIn === "object" && !Array.isArray(mapIn)
        ? (mapIn as Record<string, string>)
        : {};
    await upsertGalleryPrefsForUser(userId, { folders, folderMap });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Opslaan mislukt.";
    const status = /niet geconfigureerd/i.test(msg) ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
