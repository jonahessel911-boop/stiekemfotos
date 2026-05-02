import { NextResponse } from "next/server";
import { listUserMessageCreditUsage } from "@/lib/server/conversations";

export async function GET() {
  try {
    const messages = listUserMessageCreditUsage();
    const totalSpent = messages.reduce((s, m) => s + m.credits, 0);
    return NextResponse.json({ messages, totalSpent });
  } catch {
    return NextResponse.json({ messages: [], totalSpent: 0 });
  }
}
