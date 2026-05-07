import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";

const FILE = "stripe-checkouts.json";

type StripeCheckoutRecord = {
  sessionId: string;
  userId: string;
  credits: number;
  priceLabel: string;
  paidAt?: string;
  fulfilledAt?: string;
};

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
