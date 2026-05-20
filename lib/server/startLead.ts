import { randomBytes } from "crypto";
import { readJson, writeJson } from "@/lib/server/store";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import { scheduleAbandonmentOfferEmail } from "@/lib/server/abandonmentOffer";
import {
  createUser,
  findUserByEmail,
  persistClickIdOnUser,
  type UserRecord,
} from "@/lib/server/users";

export type OnboardingSignupRecord = {
  naam: string;
  email: string;
  leeftijd: number;
  discreetAkkoord: boolean;
  voorwaardenAkkoord: boolean;
  createdAt: string;
  /** Start-funnel variant, bv. /start/3 */
  source?: string;
};

const SIGNUPS_FILE = "onboarding-signups.json";

function randomPassword(): string {
  return randomBytes(24).toString("base64url");
}

function naamFromEmail(email: string): string {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  if (!local) return "Lid";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function loadSignupList(): Promise<OnboardingSignupRecord[]> {
  const blob = await readJsonBlob<OnboardingSignupRecord[]>(SIGNUPS_FILE, []);
  const local = readJson<OnboardingSignupRecord[]>(SIGNUPS_FILE, []);
  if (blob.length === 0) return local;
  if (local.length === 0) return blob;
  const seen = new Set<string>();
  const merged: OnboardingSignupRecord[] = [];
  for (const row of [...blob, ...local]) {
    const key = `${row.email.toLowerCase()}|${row.createdAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

async function saveSignupList(list: OnboardingSignupRecord[]): Promise<void> {
  writeJson(SIGNUPS_FILE, list);
  await writeJsonBlob(SIGNUPS_FILE, list);
}

async function appendOnboardingSignupIfNew(
  row: Omit<OnboardingSignupRecord, "createdAt"> & { createdAt?: string }
): Promise<void> {
  const list = await loadSignupList();
  const email = row.email.trim().toLowerCase();
  const hasEmail = list.some((s) => s.email.trim().toLowerCase() === email);
  if (hasEmail) return;
  list.push({
    ...row,
    email,
    createdAt: row.createdAt ?? new Date().toISOString(),
  });
  await saveSignupList(list);
}

export type RegisterStartLeadResult = {
  user: UserRecord;
  created: boolean;
};

/**
 * Start-funnel: e-mail vastleggen als signup + user (nog zonder wachtwoord inloggen).
 * Bestaande users worden hergebruikt voor Stripe/checkout.
 */
export async function registerStartLead(input: {
  email: string;
  startPath?: string;
  clickId?: string;
}): Promise<RegisterStartLeadResult> {
  const email = input.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error("Vul een geldig e-mailadres in.");
  }

  const source = input.startPath?.trim() || "/start";
  const clickId = input.clickId?.trim();

  let user = await findUserByEmail(email);
  let created = false;

  if (!user) {
    user = await createUser({
      email,
      naam: naamFromEmail(email),
      leeftijd: 35,
      password: randomPassword(),
      discreetAkkoord: true,
      voorwaardenAkkoord: true,
      ...(clickId ? { clickId } : {}),
    });
    created = true;
  } else if (clickId) {
    const updated = await persistClickIdOnUser(user.id, clickId);
    if (updated) user = updated;
  }

  await appendOnboardingSignupIfNew({
    naam: user.naam,
    email: user.email,
    leeftijd: user.leeftijd,
    discreetAkkoord: true,
    voorwaardenAkkoord: true,
    source,
  });

  if (!user.ontmoetjongensPaidAt) {
    await scheduleAbandonmentOfferEmail(user.id);
  }

  return { user, created };
}
