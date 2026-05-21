import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { listDbProfilesForAdmin } from "@/lib/server/profilesDb";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  if (!parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profiles = await listDbProfilesForAdmin(400);
  return NextResponse.json({ profiles });
}
