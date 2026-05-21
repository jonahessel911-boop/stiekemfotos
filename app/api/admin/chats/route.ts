import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { adminChatsPayload } from "@/lib/server/adminChatsPayload";
import { loadAdminDataset } from "@/lib/server/adminDataset";

export async function GET() {
  const jar = await cookies();
  if (!parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { users, conversations } = await loadAdminDataset();
  const payload = adminChatsPayload(users, conversations);
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
