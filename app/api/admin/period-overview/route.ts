import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_SESSION_COOKIE_NAME, parseAdminCookieValue } from "@/lib/server/adminAuth";
import { parseEuroFromPriceLabel } from "@/lib/server/adminAnalytics";
import { loadAdminDataset, type AdminStripeCheckoutRow } from "@/lib/server/adminDataset";

type StripeCheckoutRow = AdminStripeCheckoutRow;

function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Bucket op kalender-maand in Europe/Amsterdam (we passen alleen +1u/+2u offset toe via lokale conversie van NL-app).
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [yStr, mStr] = key.split("-");
  const y = parseInt(yStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return key;
  const d = new Date(Date.UTC(y, m - 1, 15));
  return d
    .toLocaleString("nl-NL", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());
}

function priceCents(p: StripeCheckoutRow): number {
  if (typeof p.priceEurCents === "number" && Number.isFinite(p.priceEurCents)) {
    return Math.max(0, Math.floor(p.priceEurCents));
  }
  const eur = parseEuroFromPriceLabel(p.priceLabel || "");
  return Math.round(eur * 100);
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

type PeriodRow = {
  key: string;
  label: string;
  signups: number;
  conversions: number;
  revenueEur: number;
  signupToUserChatPct: number | null;
  userChatToUnlockFreePct: number | null;
  userChatToUnlockPaidPct: number | null;
  signupToPaidPct: number | null;
  /** % cohort-signups dat een tweede keer is teruggekeerd (users.last_seen_at gevuld). */
  reSignPct: number | null;
  /**
   * % cohort-signups dat ten minste 100 credits heeft opgemaakt.
   * Definitie: ≥1 foto-unlock.
   */
  used100CreditsPct: number | null;
  /**
   * % cohort-signups dat z'n 300 gratis credits volledig heeft opgemaakt.
   * Definitie: ≥3 foto-unlocks (300 credits / 100 per unlock).
   */
  usedFreeCreditsPct: number | null;
};

/** Foto-unlocks per credit-bundel (1 unlock = 100 credits). */
const UNLOCKS_FOR_100_CREDITS = 1;
const UNLOCKS_FOR_300_CREDITS = 3;

export async function GET() {
  const jar = await cookies();
  const ok = parseAdminCookieValue(jar.get(ADMIN_SESSION_COOKIE_NAME)?.value);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { users, signups, conversations, checkouts } = await loadAdminDataset();

  /** Pre-compute per-user metrics. */
  const userFirstUserMsgAt = new Map<string, number>();
  const userFirstUnlockAt = new Map<string, number>();
  const userUnlockCount = new Map<string, number>();
  for (const c of conversations) {
    const uid = c.ownerUserId;
    if (!uid) continue;
    for (const m of c.messages) {
      if (m.role === "user") {
        const t = new Date(m.createdAt).getTime();
        if (Number.isFinite(t)) {
          const prev = userFirstUserMsgAt.get(uid);
          if (!prev || t < prev) userFirstUserMsgAt.set(uid, t);
        }
      }
      if (m.role === "assistant" && m.photoLock?.unlockedAt) {
        const t = new Date(m.photoLock.unlockedAt).getTime();
        if (Number.isFinite(t)) {
          const prev = userFirstUnlockAt.get(uid);
          if (!prev || t < prev) userFirstUnlockAt.set(uid, t);
          userUnlockCount.set(uid, (userUnlockCount.get(uid) ?? 0) + 1);
        }
      }
    }
  }

  const userFirstPaidAt = new Map<string, number>();
  for (const p of checkouts) {
    if (!p.paidAt || !p.userId) continue;
    const t = new Date(p.paidAt).getTime();
    if (!Number.isFinite(t)) continue;
    const prev = userFirstPaidAt.get(p.userId);
    if (!prev || t < prev) userFirstPaidAt.set(p.userId, t);
  }

  /** Determineer set van maanden om te tonen: vroegste signup → vandaag. */
  const monthKeys = new Set<string>();
  for (const u of users) {
    const k = monthKey(u.createdAt);
    if (k) monthKeys.add(k);
  }
  for (const s of signups) {
    const k = monthKey(s.createdAt);
    if (k) monthKeys.add(k);
  }
  for (const p of checkouts) {
    const k = monthKey(p.paidAt);
    if (k) monthKeys.add(k);
  }
  // Garandeer huidige maand
  const today = new Date();
  monthKeys.add(`${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`);

  /** Vul gaten op: van vroegste tot huidige maand alle tussenliggende maanden ook tonen. */
  const sortedKeys = [...monthKeys].sort();
  if (sortedKeys.length > 0) {
    const first = sortedKeys[0]!;
    const [fy, fm] = first.split("-").map((x) => parseInt(x, 10));
    if (Number.isFinite(fy) && Number.isFinite(fm)) {
      let y = fy!;
      let m = fm!;
      const ty = today.getUTCFullYear();
      const tm = today.getUTCMonth() + 1;
      while (y < ty || (y === ty && m <= tm)) {
        monthKeys.add(`${y}-${String(m).padStart(2, "0")}`);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
    }
  }

  const allMonths = [...monthKeys].sort().reverse(); // nieuwste eerst

  /** Bouw per maand de cohort-statistieken. */
  const rows: PeriodRow[] = allMonths.map((key) => {
    // Cohort = signups met createdAt in deze maand.
    const cohortUserIds: string[] = [];
    for (const u of users) {
      if (monthKey(u.createdAt) === key) cohortUserIds.push(u.id);
    }
    const cohortSet = new Set(cohortUserIds);

    // Signups: gebruik onboarding-signups.json als bron (onafhankelijk van user-record).
    const signupCount = signups.filter((s) => monthKey(s.createdAt) === key).length;

    // Conversions = aantal betaalde checkouts in deze maand.
    const monthPaid = checkouts.filter((p) => p.paidAt && monthKey(p.paidAt) === key);
    const conversions = monthPaid.length;
    const revenueCents = monthPaid.reduce((acc, p) => acc + priceCents(p), 0);

    // Cohort gedrag:
    let withUserChat = 0;
    let unlockedFree = 0;
    let unlockedPaid = 0;
    let paidUsers = 0;
    let reSigned = 0;
    let used100Credits = 0;
    let usedFreeCredits = 0;
    const lastSeenByUserId = new Map<string, string | undefined>();
    for (const u of users) lastSeenByUserId.set(u.id, u.lastSeenAt);
    for (const uid of cohortSet) {
      const firstUserMsg = userFirstUserMsgAt.get(uid);
      const firstUnlock = userFirstUnlockAt.get(uid);
      const firstPaid = userFirstPaidAt.get(uid);
      const hasChat = typeof firstUserMsg === "number";
      if (hasChat) withUserChat += 1;
      if (firstPaid) paidUsers += 1;
      if (lastSeenByUserId.get(uid)) reSigned += 1;
      const unlocks = userUnlockCount.get(uid) ?? 0;
      if (unlocks >= UNLOCKS_FOR_100_CREDITS) used100Credits += 1;
      if (unlocks >= UNLOCKS_FOR_300_CREDITS) usedFreeCredits += 1;

      if (hasChat && firstUnlock) {
        // Free unlock: unlock vóór eerste betaalde checkout (of nog niet betaald).
        if (!firstPaid || firstUnlock < firstPaid) unlockedFree += 1;
        // Paid unlock: er IS een betaalde checkout en er is ten minste 1 unlock op of na firstPaid.
        if (firstPaid && firstUnlock >= firstPaid) {
          unlockedPaid += 1;
        } else if (firstPaid) {
          // Wellicht zit de paid-unlock niet als eerste — scan alle messages voor deze user.
          let foundPaid = false;
          for (const c of conversations) {
            if (c.ownerUserId !== uid) continue;
            for (const m of c.messages) {
              if (m.role !== "assistant" || !m.photoLock?.unlockedAt) continue;
              const t = new Date(m.photoLock.unlockedAt).getTime();
              if (Number.isFinite(t) && t >= firstPaid) {
                foundPaid = true;
                break;
              }
            }
            if (foundPaid) break;
          }
          if (foundPaid) unlockedPaid += 1;
        }
      }
    }

    return {
      key,
      label: monthLabel(key),
      signups: signupCount,
      conversions,
      revenueEur: Math.round(revenueCents) / 100,
      signupToUserChatPct: pct(withUserChat, signupCount || cohortSet.size),
      userChatToUnlockFreePct: pct(unlockedFree, withUserChat),
      userChatToUnlockPaidPct: pct(unlockedPaid, withUserChat),
      signupToPaidPct: pct(paidUsers, signupCount || cohortSet.size),
      reSignPct: pct(reSigned, signupCount || cohortSet.size),
      used100CreditsPct: pct(used100Credits, signupCount || cohortSet.size),
      usedFreeCreditsPct: pct(usedFreeCredits, signupCount || cohortSet.size),
    };
  });

  /** Totalen-rij. */
  const totalsCohort = new Set(users.map((u) => u.id));
  const lastSeenByUserIdAll = new Map<string, string | undefined>();
  for (const u of users) lastSeenByUserIdAll.set(u.id, u.lastSeenAt);
  let totalsWithChat = 0;
  let totalsUnlockedFree = 0;
  let totalsUnlockedPaid = 0;
  let totalsPaid = 0;
  let totalsReSigned = 0;
  let totalsUsed100Credits = 0;
  let totalsUsedFreeCredits = 0;
  for (const uid of totalsCohort) {
    const firstUserMsg = userFirstUserMsgAt.get(uid);
    const firstUnlock = userFirstUnlockAt.get(uid);
    const firstPaid = userFirstPaidAt.get(uid);
    const hasChat = typeof firstUserMsg === "number";
    if (hasChat) totalsWithChat += 1;
    if (firstPaid) totalsPaid += 1;
    if (lastSeenByUserIdAll.get(uid)) totalsReSigned += 1;
    const unlocks = userUnlockCount.get(uid) ?? 0;
    if (unlocks >= UNLOCKS_FOR_100_CREDITS) totalsUsed100Credits += 1;
    if (unlocks >= UNLOCKS_FOR_300_CREDITS) totalsUsedFreeCredits += 1;
    if (hasChat && firstUnlock) {
      if (!firstPaid || firstUnlock < firstPaid) totalsUnlockedFree += 1;
      if (firstPaid) {
        let foundPaid = false;
        for (const c of conversations) {
          if (c.ownerUserId !== uid) continue;
          for (const m of c.messages) {
            if (m.role !== "assistant" || !m.photoLock?.unlockedAt) continue;
            const t = new Date(m.photoLock.unlockedAt).getTime();
            if (Number.isFinite(t) && t >= firstPaid) {
              foundPaid = true;
              break;
            }
          }
          if (foundPaid) break;
        }
        if (foundPaid) totalsUnlockedPaid += 1;
      }
    }
  }
  const totalsSignups = signups.length;
  const totalsPaidCheckouts = checkouts.filter((p) => Boolean(p.paidAt));
  const totalsRevenueCents = totalsPaidCheckouts.reduce((acc, p) => acc + priceCents(p), 0);
  const totals: PeriodRow = {
    key: "totaal",
    label: "Totaal",
    signups: totalsSignups,
    conversions: totalsPaidCheckouts.length,
    revenueEur: Math.round(totalsRevenueCents) / 100,
    signupToUserChatPct: pct(totalsWithChat, totalsSignups || totalsCohort.size),
    userChatToUnlockFreePct: pct(totalsUnlockedFree, totalsWithChat),
    userChatToUnlockPaidPct: pct(totalsUnlockedPaid, totalsWithChat),
    signupToPaidPct: pct(totalsPaid, totalsSignups || totalsCohort.size),
    reSignPct: pct(totalsReSigned, totalsSignups || totalsCohort.size),
    used100CreditsPct: pct(totalsUsed100Credits, totalsSignups || totalsCohort.size),
    usedFreeCreditsPct: pct(totalsUsedFreeCredits, totalsSignups || totalsCohort.size),
  };

  return NextResponse.json({ periods: rows, totals });
}
