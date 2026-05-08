import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified, touchUserSeen } from "@/lib/server/users";
import { createPhotoRequest, listPhotoRequests } from "@/lib/server/photoRequests";

export async function GET() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om aanvragen te bekijken." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    const requests = await listPhotoRequests();
    return NextResponse.json({ requests });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om een aanvraag te maken." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    await touchUserSeen(userId);
    const body = (await req.json()) as {
      description?: string;
      photoType?: string;
      maxCredits?: number;
      photoCategory?: "naakt" | "lingerie" | "casual";
      wantedWhen?: "vandaag" | "morgen" | "binnen_1_week";
    };
    const created = await createPhotoRequest({
      ownerUserId: userId,
      description: String(body.description ?? ""),
      photoType: String(body.photoType ?? ""),
      maxCredits: Number(body.maxCredits ?? 0),
      photoCategory: body.photoCategory,
      wantedWhen: body.wantedWhen,
    });
    return NextResponse.json({ request: created });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 400 }
    );
  }
}
