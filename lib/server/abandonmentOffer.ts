import { getSiteUrl } from "@/lib/site-url";
import { KORTING_DISCOUNT_PERCENT } from "@/lib/korting-offer";
import { sendAbandonmentOfferEmail } from "@/lib/server/email";
import { listDbProfiles } from "@/lib/server/profilesDb";
import {
  findUserByEmail,
  findUserById,
  listUsers,
  patchUserRecord,
  type UserRecord,
} from "@/lib/server/users";

const ABANDONMENT_DELAY_MS = 60 * 60 * 1000;

export function buildKortingCheckoutLink(email: string): string {
  const u = new URL("/korting", getSiteUrl());
  u.searchParams.set("email", email.trim().toLowerCase());
  u.searchParams.set("utm_source", "email");
  u.searchParams.set("utm_campaign", "abandonment62");
  return u.toString();
}

export function userNeedsAbandonmentOffer(user: UserRecord): boolean {
  if (user.ontmoetjongensPaidAt) return false;
  if (user.firstCreditPurchaseAt) return false;
  if (user.abandonmentOfferEmailSentAt) return false;
  return true;
}

/** Plan abandonment-mail 1 uur na start-lead (als nog niet betaald). */
export async function scheduleAbandonmentOfferEmail(userId: string): Promise<void> {
  const user = await findUserById(userId);
  if (!user || !userNeedsAbandonmentOffer(user)) return;
  if (user.abandonmentOfferDueAt) return;

  const dueAt = new Date(Date.now() + ABANDONMENT_DELAY_MS).toISOString();
  await patchUserRecord(userId, { abandonmentOfferDueAt: dueAt });
}

export async function pickAbandonmentEmailProfile(): Promise<{ name: string; age: number }> {
  const profiles = await listDbProfiles(48);
  const young = profiles.filter((p) => p.age >= 18 && p.age <= 24);
  const pool = young.length > 0 ? young : profiles.slice(0, 12);
  const fallback = { name: "Lucas", age: 18 };
  if (pool.length === 0) return fallback;
  const p = pool[Math.floor(Math.random() * pool.length)]!;
  return { name: p.name, age: p.age };
}

export async function sendAbandonmentOfferForUser(user: UserRecord): Promise<boolean> {
  if (!userNeedsAbandonmentOffer(user)) return false;
  if (user.abandonmentOfferDueAt && Date.now() < new Date(user.abandonmentOfferDueAt).getTime()) {
    return false;
  }

  const profile = await pickAbandonmentEmailProfile();
  const checkoutLink = buildKortingCheckoutLink(user.email);

  await sendAbandonmentOfferEmail({
    to: user.email,
    naam: user.naam,
    checkoutLink,
    subjectProfileName: profile.name,
    subjectProfileAge: profile.age,
    discountPercent: KORTING_DISCOUNT_PERCENT,
  });

  await patchUserRecord(user.id, {
    abandonmentOfferEmailSentAt: new Date().toISOString(),
  });
  return true;
}

export async function processAbandonmentOfferForUserId(userId: string): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user) return false;
  return sendAbandonmentOfferForUser(user);
}

export async function processDueAbandonmentOfferEmails(): Promise<{
  scanned: number;
  sent: number;
}> {
  const users = await listUsers();
  let sent = 0;
  for (const user of users) {
    if (!userNeedsAbandonmentOffer(user)) continue;
    if (!user.abandonmentOfferDueAt) continue;
    if (Date.now() < new Date(user.abandonmentOfferDueAt).getTime()) continue;
    try {
      if (await sendAbandonmentOfferForUser(user)) sent += 1;
    } catch (e) {
      console.warn(
        `[abandonment-offer] mislukt user=${user.id}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return { scanned: users.length, sent };
}

export async function resolveUserForKortingPage(email: string): Promise<UserRecord | null> {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  return findUserByEmail(clean);
}
