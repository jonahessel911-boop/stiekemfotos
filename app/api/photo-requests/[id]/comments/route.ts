import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified, touchUserSeen } from "@/lib/server/users";
import { addPhotoRequestComment, addUserCommentToPhotoRequest } from "@/lib/server/photoRequests";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om te reageren." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    await touchUserSeen(userId);
    const { id } = await context.params;
    const body = (await req.json()) as {
      profileId?: string;
      text?: string;
      sendInboxMessage?: boolean;
    };
    const hasProfileActor = String(body.profileId ?? "").trim().length > 0;
    const updated = hasProfileActor
      ? await addPhotoRequestComment({
          actorUserId: userId,
          requestId: id,
          profileId: String(body.profileId ?? ""),
          text: String(body.text ?? ""),
          sendInboxMessage: body.sendInboxMessage === true,
        })
      : await addUserCommentToPhotoRequest({
          actorUserId: userId,
          requestId: id,
          text: String(body.text ?? ""),
        });
    return NextResponse.json({ request: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 400 }
    );
  }
}
