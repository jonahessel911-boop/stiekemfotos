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

    // Simple formula as requested: every user starts with 100 credits, deduct 10 per message.
    // (purchases add on top; ledger can be extended later for authoritative balance)
    const computedBalance = 100 + 0 - totalSpent; // extend with purchase total from ledger/purchases table as needed

    return NextResponse.json({ 
      messages, 
      totalSpent, 
      balance: Math.max(0, computedBalance),
      initialFree: 100,
      perMessage: 10 
    });
  } catch {
    return NextResponse.json({ messages: [], totalSpent: 0, balance: 100, initialFree: 100, perMessage: 10 });
  }
}
