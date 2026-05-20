import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";

const FILE = "stripe-checkouts.json";

type StripeCheckoutRecord = {
  sessionId: string;
  userId: string;
  credits: number;
  priceLabel: string;
  /** Exact bedrag in eurocenten — wordt vanaf nu altijd geschreven; legacy records hebben dit veld nog niet. */
  priceEurCents?: number;
  paidAt?: string;
  fulfilledAt?: string;
  /** ClickFlare click_id bij checkout (fallback als Stripe metadata leeg is). */
  clickId?: string;
  /** ClickFlare postback al verstuurd voor deze sessie. */
  clickflareSentAt?: string;
};

export type { StripeCheckoutRecord };

/**
 * Parse "€19,99 · 300 credits" / "€10,00" / "9.99" naar een cent-bedrag.
 * Best-effort fallback voor legacy records die nog geen `priceEurCents` opgeslagen hebben.
 */
function parsePriceLabelCents(label: string | undefined): number | null {
  if (!label) return null;
  const match = label.match(/([0-9]+)[.,]([0-9]{1,2})/);
  if (!match) return null;
  const whole = parseInt(match[1]!, 10);
  const fracRaw = match[2]!;
  const frac = parseInt(fracRaw.padEnd(2, "0").slice(0, 2), 10);
  if (!Number.isFinite(whole) || !Number.isFinite(frac)) return null;
  return whole * 100 + frac;
}

function recordCents(rec: StripeCheckoutRecord): number {
  if (typeof rec.priceEurCents === "number" && Number.isFinite(rec.priceEurCents)) {
    return Math.max(0, Math.floor(rec.priceEurCents));
  }
  const parsed = parsePriceLabelCents(rec.priceLabel);
  return parsed ?? 0;
}

async function load(): Promise<StripeCheckoutRecord[]> {
  return readJsonBlob<StripeCheckoutRecord[]>(FILE, []);
}

async function save(list: StripeCheckoutRecord[]): Promise<void> {
  await writeJsonBlob(FILE, list);
}

export async function upsertStripeCheckoutRecord(next: StripeCheckoutRecord): Promise<void> {
  const list = await load();
  const i = list.findIndex((x) => x.sessionId === next.sessionId);
  if (i === -1) {
    list.push(next);
  } else {
    list[i] = { ...list[i]!, ...next };
  }
  await save(list);
}

export async function markStripeCheckoutPaid(sessionId: string): Promise<void> {
  const list = await load();
  const i = list.findIndex((x) => x.sessionId === sessionId);
  if (i === -1) return;
  list[i] = { ...list[i]!, paidAt: new Date().toISOString() };
  await save(list);
}

export async function consumeStripeCheckoutForUser(
  sessionId: string,
  userId: string
): Promise<
  | { status: "consumed"; credits: number; priceLabel: string }
  | { status: "already_fulfilled" }
  | { status: "not_ready" }
  | null
> {
  const list = await load();
  const i = list.findIndex((x) => x.sessionId === sessionId);
  if (i === -1) return null;
  const rec = list[i]!;
  if (rec.userId !== userId) return null;
  if (rec.fulfilledAt) return { status: "already_fulfilled" };
  if (!rec.paidAt) return { status: "not_ready" };
  list[i] = { ...rec, fulfilledAt: new Date().toISOString() };
  await save(list);
  return { status: "consumed", credits: rec.credits, priceLabel: rec.priceLabel };
}

export async function getStripeCheckoutBySessionId(
  sessionId: string
): Promise<StripeCheckoutRecord | null> {
  const list = await load();
  return list.find((x) => x.sessionId === sessionId) ?? null;
}

/**
 * Som van alle betaalde Stripe checkouts voor een user (in eurocenten).
 * Telt elke record met een gezette `paidAt` (geld is ontvangen — fulfilment volgt apart).
 * Voor legacy records zonder `priceEurCents` wordt het bedrag uit `priceLabel` afgeleid.
 */
export async function getUserTotalPaidCents(userId: string): Promise<number> {
  const id = userId.trim();
  if (!id) return 0;
  const list = await load();
  let totalCents = 0;
  for (const rec of list) {
    if (rec.userId !== id) continue;
    if (!rec.paidAt) continue;
    totalCents += recordCents(rec);
  }
  return totalCents;
}
