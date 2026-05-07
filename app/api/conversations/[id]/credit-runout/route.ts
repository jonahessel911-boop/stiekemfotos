import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { scheduleAutoGiftAfterCreditRunout } from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";
import { isUserEmailVerified } from "@/lib/server/users";

/**
 * Client roept dit aan wanneer de gebruiker in dit gesprek geen credits meer heeft
 * (na sturen of bij geblokkeerde send). Server plant alleen een cadeau als er al
 * twee kanten hebben gechat en de gebruiker nog nooit heeft gekocht.
 */
export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!userId) {
      return NextResponse.json({ error: "Log in vereist." }, { status: 401 });
    }
    if (!(await isUserEmailVerified(userId))) {
      return NextResponse.json({ error: "Verifieer eerst je e-mail." }, { status: 403 });
    }
    const { scheduled } = await scheduleAutoGiftAfterCreditRunout(id, userId);
    return NextResponse.json({ ok: true, scheduled });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
