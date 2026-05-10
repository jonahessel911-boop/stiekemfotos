import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readJsonBlob } from "@/lib/server/blobJson";
import { readJson } from "@/lib/server/store";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import type { Conversation } from "@/lib/types/chat";
import {
  computeConversationAnalytics,
  revenueAndPurchasesByDay,
  signupsByDay,
} from "@/lib/server/adminAnalytics";

type SignupRow = {
  naam: string;
  email: string;
  leeftijd: number;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  naam: string;
  leeftijd: number;
  createdAt: string;
  emailVerifiedAt?: string;
  emailVerifyToken?: string;
};

type StripeCheckoutRow = {
  sessionId: string;
  userId: string;
  credits: number;
  priceLabel: string;
  paidAt?: string;
  fulfilledAt?: string;
};

export async function GET() {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [users, conversations, checkouts] = await Promise.all([
    readJsonBlob<UserRow[]>("users.json", []),
    readJsonBlob<Conversation[]>("conversations.json", []),
    readJsonBlob<StripeCheckoutRow[]>("stripe-checkouts.json", []),
  ]);
  const signups = readJson<SignupRow[]>("onboarding-signups.json", []);

  const paid = checkouts.filter((x) => Boolean(x.paidAt));
  const usersMap = new Map(users.map((u) => [u.id, u]));

  const usersSummary = users.map((u) => {
    const convs = conversations.filter((c) => c.ownerUserId === u.id);
    const purchases = paid.filter((p) => p.userId === u.id);
    const spentMessages = convs.reduce(
      (acc, c) => acc + c.messages.filter((m) => m.role === "user").length,
      0
    );
    return {
      id: u.id,
      email: u.email,
      naam: u.naam,
      leeftijd: u.leeftijd,
      createdAt: u.createdAt,
      emailVerified: Boolean(u.emailVerifiedAt) || !u.emailVerifyToken,
      conversations: convs.length,
      userMessages: spentMessages,
      purchasesCount: purchases.length,
      purchasedCredits: purchases.reduce((acc, p) => acc + p.credits, 0),
    };
  });

  const conversationsByUser = users.map((u) => ({
    userId: u.id,
    userEmail: u.email,
    userName: u.naam,
    conversations: conversations
      .filter((c) => c.ownerUserId === u.id)
      .map((c) => ({
        id: c.id,
        profileName: c.profileName,
        updatedAt: c.updatedAt,
        messages: c.messages.length,
        lastMessage: c.messages[c.messages.length - 1]?.content ?? "",
        history: c.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      })),
  }));

  const purchasesTable = paid
    .map((p) => ({
      sessionId: p.sessionId,
      userId: p.userId,
      userEmail: usersMap.get(p.userId)?.email ?? "onbekend",
      credits: p.credits,
      priceLabel: p.priceLabel,
      paidAt: p.paidAt ?? "",
      fulfilledAt: p.fulfilledAt ?? "",
    }))
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());

  const signupsTable = [...signups].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const conversationAnalytics = computeConversationAnalytics(conversations);
  const chartDays = 30;
  const signupDaily = signupsByDay(signups, chartDays);
  const {
    revenueByDay,
    purchasesByDay,
    revenueEurTotal,
    totalCreditsPurchased,
  } = revenueAndPurchasesByDay(paid, chartDays);

  return NextResponse.json({
    stats: {
      users: users.length,
      signups: signups.length,
      purchases: purchasesTable.length,
      conversations: conversations.length,
    },
    analytics: {
      ...conversationAnalytics,
      revenueEurTotal,
      totalCreditsPurchased,
      revenueByDay,
      purchasesByDay,
      signupsByDay: signupDaily,
      chartDays,
    },
    signups: signupsTable,
    users: usersSummary,
    purchases: purchasesTable,
    conversationsByUser,
  });
}
