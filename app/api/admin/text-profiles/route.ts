import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { createWestEuropeTextProfiles } from "@/lib/server/westEuropeTextProfiles";

/** Alleen Grok + DB — geen image generation. */
export const maxDuration = 300;

export async function POST(req: Request) {
  const jar = await cookies();
  if (!parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let count = 10;
  let inactiveUntilPhotos = true;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      count?: unknown;
      inactiveUntilPhotos?: unknown;
      pasZichtbaarMetFotos?: unknown;
    };
    if (typeof body.count === "number" && Number.isFinite(body.count)) {
      count = body.count;
    }
    if (body.inactiveUntilPhotos === false || body.pasZichtbaarMetFotos === false) {
      inactiveUntilPhotos = false;
    }
  } catch {
    /* default */
  }

  try {
    const { created, errors } = await createWestEuropeTextProfiles(count, {
      inactiveUntilPhotos,
    });
    return NextResponse.json({
      ok: true,
      requested: count,
      createdCount: created.length,
      items: created,
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Batch mislukt",
        items: [],
        errors: [],
      },
      { status: 500 }
    );
  }
}
