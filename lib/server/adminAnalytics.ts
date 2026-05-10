import type { Conversation } from "@/lib/types/chat";

/** Parse Dutch-style price labels like "€19,99" or "13,99". */
export function parseEuroFromPriceLabel(label: string): number {
  if (!label?.trim()) return 0;
  const s = label.trim();
  const comma = s.match(/€?\s*([\d]{1,4})\s*,\s*(\d{2})/);
  if (comma) return parseFloat(`${comma[1]}.${comma[2]}`);
  const dot = s.match(/€?\s*([\d]{1,4})\s*\.\s*(\d{2})/);
  if (dot) return parseFloat(`${dot[1]}.${dot[2]}`);
  return 0;
}

export type AdminConversationAnalytics = {
  uniqueChatConversations: number;
  /** Assistant locked-photo bubbles (premium pipeline). */
  totalLockedImagesSent: number;
  /** User-uploaded images in chat (separate from locked assistant photos). */
  totalUserImagesSent: number;
  totalImagesUnlocked: number;
  unlockConversionPercent: number | null;
  /** Of conversations with ≥1 user message: % that received ≥1 locked assistant photo after first user msg. */
  firstUserMessageToFirstLockedImagePercent: number | null;
  /** Of users who unlocked ≥1 image: % who unlocked ≥2 images (all conversations). */
  firstUnlockToSecondUnlockPercent: number | null;
};

type StripePaid = { credits: number; priceLabel: string; paidAt?: string };

export function computeConversationAnalytics(conversations: Conversation[]): AdminConversationAnalytics {
  const owned = conversations.filter((c) => Boolean(c.ownerUserId));
  const uniqueChatConversations = owned.length;

  let totalLockedImagesSent = 0;
  let totalUserImagesSent = 0;
  let totalImagesUnlocked = 0;

  let eligibleFirstUserToImage = 0;
  let convertedFirstUserToImage = 0;

  const unlockCountsByUserId = new Map<string, number>();

  for (const c of owned) {
    const uid = c.ownerUserId!;
    for (const m of c.messages) {
      if (m.role === "user" && m.imageFile) totalUserImagesSent += 1;
      if (m.role !== "assistant" || !m.photoLock) continue;
      totalLockedImagesSent += 1;
      if (m.photoLock.unlockedAt) {
        totalImagesUnlocked += 1;
        unlockCountsByUserId.set(uid, (unlockCountsByUserId.get(uid) ?? 0) + 1);
      }
    }

    const userMsgs = c.messages.filter((m) => m.role === "user");
    if (userMsgs.length === 0) continue;

    eligibleFirstUserToImage += 1;
    const firstUserTime = Math.min(
      ...userMsgs.map((m) => new Date(m.createdAt).getTime())
    );
    const gotLockedImageAfterChat = c.messages.some(
      (m) =>
        m.role === "assistant" &&
        m.photoLock &&
        new Date(m.createdAt).getTime() >= firstUserTime
    );
    if (gotLockedImageAfterChat) convertedFirstUserToImage += 1;
  }

  const unlockConversionPercent =
    totalLockedImagesSent > 0
      ? Math.round((totalImagesUnlocked / totalLockedImagesSent) * 1000) / 10
      : null;

  const firstUserMessageToFirstLockedImagePercent =
    eligibleFirstUserToImage > 0
      ? Math.round((convertedFirstUserToImage / eligibleFirstUserToImage) * 1000) / 10
      : null;

  let usersWithOnePlusUnlock = 0;
  let usersWithTwoPlusUnlock = 0;
  for (const n of unlockCountsByUserId.values()) {
    if (n >= 1) usersWithOnePlusUnlock += 1;
    if (n >= 2) usersWithTwoPlusUnlock += 1;
  }

  const firstUnlockToSecondUnlockPercent =
    usersWithOnePlusUnlock > 0
      ? Math.round((usersWithTwoPlusUnlock / usersWithOnePlusUnlock) * 1000) / 10
      : null;

  return {
    uniqueChatConversations,
    totalLockedImagesSent,
    totalUserImagesSent,
    totalImagesUnlocked,
    unlockConversionPercent,
    firstUserMessageToFirstLockedImagePercent,
    firstUnlockToSecondUnlockPercent,
  };
}

export type DailyBucket = { date: string; value: number };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Last `days` calendar days including today; fill missing with 0. */
export function bucketsLastDays(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    out.push(isoDay(d));
  }
  return out;
}

export function signupsByDay(signups: { createdAt: string }[], days = 30): DailyBucket[] {
  const keys = bucketsLastDays(days);
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, 0);
  for (const s of signups) {
    try {
      const day = new Date(s.createdAt).toISOString().slice(0, 10);
      if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
    } catch {
      /* skip */
    }
  }
  return keys.map((date) => ({ date, value: counts.get(date) ?? 0 }));
}

export function revenueAndPurchasesByDay(paid: StripePaid[], days = 30): {
  revenueByDay: DailyBucket[];
  purchasesByDay: DailyBucket[];
  revenueEurTotal: number;
  totalCreditsPurchased: number;
} {
  const keys = bucketsLastDays(days);
  const revenueMap = new Map<string, number>();
  const purchaseCountMap = new Map<string, number>();
  for (const k of keys) {
    revenueMap.set(k, 0);
    purchaseCountMap.set(k, 0);
  }

  let revenueEurTotal = 0;
  let totalCreditsPurchased = 0;

  for (const p of paid) {
    if (!p.paidAt) continue;
    totalCreditsPurchased += p.credits;
    const eur = parseEuroFromPriceLabel(p.priceLabel);
    revenueEurTotal += eur;
    try {
      const day = new Date(p.paidAt).toISOString().slice(0, 10);
      if (revenueMap.has(day)) {
        revenueMap.set(day, (revenueMap.get(day) ?? 0) + eur);
        purchaseCountMap.set(day, (purchaseCountMap.get(day) ?? 0) + 1);
      }
    } catch {
      /* skip */
    }
  }

  return {
    revenueByDay: keys.map((date) => ({ date, value: Math.round((revenueMap.get(date) ?? 0) * 100) / 100 })),
    purchasesByDay: keys.map((date) => ({ date, value: purchaseCountMap.get(date) ?? 0 })),
    revenueEurTotal: Math.round(revenueEurTotal * 100) / 100,
    totalCreditsPurchased,
  };
}
