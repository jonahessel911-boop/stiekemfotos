import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listUserMessageCreditUsage } from "@/lib/server/conversations";
import { INITIAL_FREE_CREDITS, CREDITS_PER_MESSAGE } from "@/lib/credit-packages";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";

export async function GET() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    const messages = await listUserMessageCreditUsage(userId);
    const totalSpent = messages.reduce((s, m) => s + m.credits, 0);

    const computedBalance = INITIAL_FREE_CREDITS - totalSpent;

    return NextResponse.json({
      messages,
      totalSpent,
      balance: Math.max(0, computedBalance),
      initialFree: INITIAL_FREE_CREDITS,
      perMessage: CREDITS_PER_MESSAGE,
    });
  } catch {
    return NextResponse.json({
      messages: [],
      totalSpent: 0,
      balance: INITIAL_FREE_CREDITS,
      initialFree: INITIAL_FREE_CREDITS,
      perMessage: CREDITS_PER_MESSAGE,
    });
  }
}
