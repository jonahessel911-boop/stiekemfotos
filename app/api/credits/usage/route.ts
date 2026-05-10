import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listUserMessageCreditUsage } from "@/lib/server/conversations";
import { parseSessionValue, SESSION_COOKIE_NAME } from "@/lib/server/session";

export async function GET() {
  try {
    const jar = await cookies();
    const userId = parseSessionValue(jar.get(SESSION_COOKIE_NAME)?.value);
    const messages = await listUserMessageCreditUsage(userId);
    const totalSpent = messages.reduce((s, m) => s + m.credits, 0);

    const START_BALANCE = 200;
    const computedBalance = START_BALANCE - totalSpent;

    return NextResponse.json({
      messages,
      totalSpent,
      balance: Math.max(0, computedBalance),
      initialFree: START_BALANCE,
      perMessage: 0,
    });
  } catch {
    return NextResponse.json({
      messages: [],
      totalSpent: 0,
      balance: 200,
      initialFree: 200,
      perMessage: 0,
    });
  }
}
