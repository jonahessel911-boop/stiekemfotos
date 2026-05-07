import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isUserEmailVerified, markCreditPurchase } from "@/lib/server/users";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";

export async function POST() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    await markCreditPurchase(userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
