/** Client-side credits (demo; geen echte betaling). */

const KEY_V2 = "dm_credits_balance_v2";
const KEY_V1 = "dm_credits_balance_v1";
const PURCHASES_KEY = "dm_credits_purchases_v1";

export type CreditPurchaseRecord = {
  id: string;
  at: string;
  credits: number;
  priceLabel: string;
};

/** Eén verstuurd bericht (per stuk in een batch) kost dit veel credits. */
export const CREDITS_PER_MESSAGE = 10;

/** Startbalans: eerste credits gratis. */
export const INITIAL_FREE_CREDITS = 100;

export function notifyCreditsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("dm-credits-updated"));
  }
}

export function getCreditsBalance(): number {
  if (typeof window === "undefined") return INITIAL_FREE_CREDITS;
  try {
    const v2 = localStorage.getItem(KEY_V2);
    if (v2 !== null) {
      const n = parseInt(v2, 10);
      return Number.isFinite(n) ? Math.max(0, n) : INITIAL_FREE_CREDITS;
    }
    const v1 = localStorage.getItem(KEY_V1);
    if (v1 !== null) {
      const n = parseInt(v1, 10);
      const migrated = Number.isFinite(n) ? Math.max(0, n) : INITIAL_FREE_CREDITS;
      localStorage.setItem(KEY_V2, String(migrated));
      return migrated;
    }
    localStorage.setItem(KEY_V2, String(INITIAL_FREE_CREDITS));
    return INITIAL_FREE_CREDITS;
  } catch {
    return INITIAL_FREE_CREDITS;
  }
}

export function setCreditsBalance(n: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY_V2, String(Math.max(0, Math.floor(n))));
  notifyCreditsUpdated();
}

function readPurchases(): CreditPurchaseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PURCHASES_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as CreditPurchaseRecord[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function writePurchases(records: CreditPurchaseRecord[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PURCHASES_KEY, JSON.stringify(records));
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
}

export function spendChatCredit(amount: number = CREDITS_PER_MESSAGE) {
  setCreditsBalance(getCreditsBalance() - amount);
}

export function creditsCostForBatchSize(batchLength: number): number {
  return batchLength * CREDITS_PER_MESSAGE;
}
