/** Client-side credits (demo; geen echte betaling). */

const KEY_V2 = "dm_credits_balance_v2";
const KEY_V1 = "dm_credits_balance_v1";
const PURCHASES_KEY = "dm_credits_purchases_v1";
const USER_KEY = "dm_user_v1";

export type CreditPurchaseRecord = {
  id: string;
  at: string;
  credits: number;
  priceLabel: string;
};

/**
 * Chatten is gratis op het platform. Berichten kosten dus geen credits.
 * Credits worden alleen ingezet om foto's van vrouwen te ontgrendelen
 * (1 foto = `CREDITS_PER_PHOTO_UNLOCK`).
 */
export const CREDITS_PER_MESSAGE = 0;

/** Wat een foto van een vrouw ontgrendelen kost. */
export const CREDITS_PER_PHOTO_UNLOCK = 100;

/** Startbalans bij nieuwe accounts. Chatten is gratis dus geen extra startkrediet. */
export const INITIAL_FREE_CREDITS = 0;

export function notifyCreditsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("dm-credits-updated"));
  }
}

export function notifyCreditsPurchased(detail?: { credits?: number; priceLabel?: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("dm-credits-purchased", {
      detail: detail ?? {},
    })
  );
}

function currentUserScope(): string {
  if (typeof window === "undefined") return "guest";
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return "guest";
    const parsed = JSON.parse(raw) as { id?: string; email?: string };
    const key = (parsed.id ?? parsed.email ?? "").trim().toLowerCase();
    return key || "guest";
  } catch {
    return "guest";
  }
}

function scopedBalanceKey(): string {
  return `${KEY_V2}:${currentUserScope()}`;
}

function scopedPurchasesKey(): string {
  return `${PURCHASES_KEY}:${currentUserScope()}`;
}

export function getCreditsBalance(): number {
  if (typeof window === "undefined") return INITIAL_FREE_CREDITS;
  try {
    const key = scopedBalanceKey();
    const v2 = localStorage.getItem(key);
    if (v2 !== null) {
      const n = parseInt(v2, 10);
      return Number.isFinite(n) ? Math.max(0, n) : INITIAL_FREE_CREDITS;
    }
    const scope = currentUserScope();
    // Alleen guest: migreer oude globale sleutels. Ingelogde accounts krijgen anders per ongeluk
    // een oud demo-/testsaldo (bijv. 1100) van dezelfde browser mee i.p.v. INITIAL_FREE_CREDITS.
    if (scope === "guest") {
      const legacyV2 = localStorage.getItem(KEY_V2);
      if (legacyV2 !== null) {
        const n = parseInt(legacyV2, 10);
        const migrated = Number.isFinite(n) ? Math.max(0, n) : INITIAL_FREE_CREDITS;
        localStorage.setItem(key, String(migrated));
        return migrated;
      }
      const v1 = localStorage.getItem(KEY_V1);
      if (v1 !== null) {
        const n = parseInt(v1, 10);
        const migrated = Number.isFinite(n) ? Math.max(0, n) : INITIAL_FREE_CREDITS;
        localStorage.setItem(key, String(migrated));
        return migrated;
      }
    }
    localStorage.setItem(key, String(INITIAL_FREE_CREDITS));
    return INITIAL_FREE_CREDITS;
  } catch {
    return INITIAL_FREE_CREDITS;
  }
}

// Keep sync version for backward compatibility (uses cached or local)
export function getCreditsBalanceSync(): number {
  if (typeof window === "undefined") return INITIAL_FREE_CREDITS;
  try {
    const key = scopedBalanceKey();
    const v2 = localStorage.getItem(key);
    if (v2 !== null) {
      const n = parseInt(v2, 10);
      return Number.isFinite(n) ? Math.max(0, n) : INITIAL_FREE_CREDITS;
    }
  } catch {}
  return INITIAL_FREE_CREDITS;
}

export function setCreditsBalance(n: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(scopedBalanceKey(), String(Math.max(0, Math.floor(n))));
  notifyCreditsUpdated();
}

function readPurchases(): CreditPurchaseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(scopedPurchasesKey());
    if (!raw) return [];
    const p = JSON.parse(raw) as CreditPurchaseRecord[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function writePurchases(records: CreditPurchaseRecord[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(scopedPurchasesKey(), JSON.stringify(records));
}

/** Aankopen (demo) voor transactie-overzicht op /credits. */
export function getCreditPurchaseHistory(): CreditPurchaseRecord[] {
  return readPurchases().sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}

/** Demo: credits bij „aankoop”; `priceLabel` verschijnt in het transactieoverzicht. */
export function addCredits(amount: number, priceLabel?: string) {
  const n = Math.floor(amount);
  setCreditsBalance(getCreditsBalance() + n);
  if (typeof window !== "undefined") {
    const rec: CreditPurchaseRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      at: new Date().toISOString(),
      credits: n,
      priceLabel: priceLabel?.trim() || "Pakket gekocht",
    };
    writePurchases([rec, ...readPurchases()]);
  }
  notifyCreditsUpdated();
  notifyCreditsPurchased({ credits: n, priceLabel });
  // Server-side marker voor "eerste aankoop gedaan" (best effort).
  if (typeof window !== "undefined") {
    void fetch("/api/credits/purchase", {
      method: "POST",
      credentials: "include",
      keepalive: true,
    }).catch(() => {
      /* ignore */
    });
  }
}

export function spendChatCredit(amount: number = CREDITS_PER_MESSAGE) {
  if (amount <= 0) return;
  // Now primarily handled server-side via ledger. Local update for immediate UI feedback.
  const current = getCreditsBalanceSync();
  setCreditsBalance(current - amount);
}

/** Trekt credits af voor het ontgrendelen van een foto (client-side optimistic). */
export function spendPhotoUnlock(amount: number = CREDITS_PER_PHOTO_UNLOCK) {
  if (amount <= 0) return;
  const current = getCreditsBalanceSync();
  setCreditsBalance(current - amount);
}

/** True als de gebruiker genoeg saldo heeft om een foto te ontgrendelen. */
export function canAffordPhotoUnlock(): boolean {
  return getCreditsBalanceSync() >= CREDITS_PER_PHOTO_UNLOCK;
}

/** Terugboeken als verzending faalt na een directe (optimistische) aftrek. */
export function refundChatCredit(amount: number) {
  if (typeof window === "undefined") return;
  const n = Math.floor(amount);
  if (n <= 0) return;
  setCreditsBalance(getCreditsBalanceSync() + n);
}

export function creditsCostForBatchSize(batchLength: number): number {
  return batchLength * CREDITS_PER_MESSAGE;
}

/** Prijs-label dat we tonen voor het standaardpakket (1 foto). */
export const PHOTO_PACKAGE_PRICE_LABEL = "€19,99";
export const PHOTO_PACKAGE_CREDITS = CREDITS_PER_PHOTO_UNLOCK;
