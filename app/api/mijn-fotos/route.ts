import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified } from "@/lib/server/users";
import { listPurchasedPhotosForOwner } from "@/lib/server/conversations";

export async function GET() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in om je foto's te bekijken." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    const items = await listPurchasedPhotosForOwner(userId);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout bij ophalen van je foto's." },
      { status: 500 }
    );
  }
}

