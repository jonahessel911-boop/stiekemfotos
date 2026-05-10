import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseAdminCookieValue, ADMIN_SESSION_COOKIE_NAME } from "@/lib/server/adminAuth";
import { createRandomProfileWithPhotos } from "@/lib/server/randomProfileFactory";

/** Image-gen kan lang duren op cold starts; Vercel Hobby max = 300s. */
export const maxDuration = 300;

/**
 * Één random profiel per POST — hetzelfde pad als "Maak random profiel aan".
 * Voor meerdere profielen: client roept deze route meerdere keren aan.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let everydayLook = false;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      everydayLook?: unknown;
      minderKnap?: unknown;
    };
    everydayLook = Boolean(body.everydayLook ?? body.minderKnap);
  } catch {
    everydayLook = false;
  }

  try {
    const created = await createRandomProfileWithPhotos(
      everydayLook ? { everydayLook: true } : undefined
    );
    return NextResponse.json({
      items: [created],
      errors: [] as { index: number; message: string }[],
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Random profiel aanmaken mislukt",
        items: [],
        errors: [] as { index: number; message: string }[],
      },
      { status: 500 }
    );
  }
}
