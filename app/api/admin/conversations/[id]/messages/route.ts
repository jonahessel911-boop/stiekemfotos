import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { appendAdminAssistantReply } from "@/lib/server/conversations";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const jar = await cookies();
    if (!parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = (await req.json()) as { content?: string };
    const content = String(body.content ?? "").trim();
    if (!content) {
      return NextResponse.json({ error: "Bericht is leeg" }, { status: 400 });
    }

    const result = await appendAdminAssistantReply(id, content);
    return NextResponse.json({
      ok: true,
      message: {
        id: result.message.id,
        role: result.message.role,
        content: result.message.content,
        createdAt: result.message.createdAt,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Versturen mislukt" },
      { status: 400 }
    );
  }
}
