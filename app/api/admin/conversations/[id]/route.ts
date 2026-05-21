import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { loadConversationById } from "@/lib/server/conversationsRelational";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const jar = await cookies();
  if (!parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database niet beschikbaar" }, { status: 503 });
  }
  const conv = await loadConversationById(admin, id);
  if (!conv) {
    return NextResponse.json({ error: "Gesprek niet gevonden" }, { status: 404 });
  }

  return NextResponse.json({
    conversation: {
      id: conv.id,
      profileName: conv.profileName,
      updatedAt: conv.updatedAt,
      ownerUserId: conv.ownerUserId,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    },
  });
}
