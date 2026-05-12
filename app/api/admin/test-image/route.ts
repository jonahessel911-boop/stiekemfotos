import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseAdminCookieValue, ADMIN_SESSION_COOKIE_NAME } from "@/lib/server/adminAuth";
import { getDbProfileById } from "@/lib/server/profilesDb";
import { generateRealisticImageDetailed, buildNudePrompt } from "@/lib/server/imageGen";

export async function POST(req: Request) {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as { profileId?: string; userRequest?: string };
    const profileId = body.profileId?.trim();
    const userRequest = body.userRequest?.trim();

    if (!profileId) return NextResponse.json({ error: "Profile ID required" }, { status: 400 });
    if (!userRequest) return NextResponse.json({ error: "User request required" }, { status: 400 });

    const profile = await getDbProfileById(profileId);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const prompt = buildNudePrompt(profile, userRequest);

    // Use a test conversation ID for admin testing
    const testConvId = "admin-test";
    const testMsgId = `test-${Date.now()}`;

    const generated = await generateRealisticImageDetailed(
      {
        prompt,
        width: 1024,
        height: 1024,
        steps: 9,
        randomSeed: true,
      },
      testConvId,
      testMsgId
    );
    const filename = generated.filename;

    if (!filename) {
      return NextResponse.json(
        {
          error: "Image generation failed",
          detail: generated.errorDetail ?? null,
          prompt,
        },
        { status: 500 }
      );
    }

    /**
     * Voorkeur: persistent Supabase Storage URL uit `generated.publicUrl`.
     * Fallback: legacy proxy-route op `/api/conversations/.../image/...`
     * voor dev-omgeving zonder Supabase admin client.
     */
    const imageUrl =
      generated.publicUrl?.trim() ||
      `/api/conversations/${testConvId}/image/${testMsgId}`;

    return NextResponse.json({
      prompt,
      imageUrl,
      filename,
      publicUrl: generated.publicUrl ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}
