import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import {
  resolveEngagementSlotsForNewUser,
  type EngagementSlot,
} from "@/lib/server/engagementSlots";
import { upsertAppUserToSupabaseUsers } from "@/lib/server/supabaseUserSync";
import { mergePersonalFacts, type UserPersonalFacts } from "@/lib/user-personal-facts";

const FILE = "users.json";

export type UserRecord = {
  id: string;
  email: string;
  naam: string;
  leeftijd: number;
  passwordHash: string;
  discreetAkkoord: boolean;
  voorwaardenAkkoord: boolean;
  createdAt: string;
  emailVerifyToken?: string;
  emailVerifiedAt?: string;
  /** Voorkeuren uit onboarding (optioneel) */
  zoekLeeftijdCategorie?: string;
  zoekEigenschappen?: string[];
  geschatteMatches?: number;
  /** Geplande ijsbrekers van profielen over meerdere dagen. */
  engagementSlots?: EngagementSlot[];
  /**
   * Automatische outreach (startinbox, ijsbrekers, like-nudges): rolling week anti-spam.
   * Elke entry = één verstuurd automatisch assistentbericht; distinct profileIds tellen mee tot max 3/week.
   */
  engagementOutboundLog?: Array<{ profileId: string; sentAt: string }>;
  /** Eerste echte credit-aankoopmoment (server side marker). */
  firstCreditPurchaseAt?: string;
  /** Laatste actieve moment in de app (voor offline e-mail triggers). */
  lastSeenAt?: string;
  /**
   * Laatste “inbox”-notificatie (offline nieuw bericht / cadeau-mail).
   * Max. 1 per uur; los van verificatie- en wachtwoordmails.
   */
  lastInboxNotificationEmailAt?: string;
  /**
   * Dagelijkse reactivation-mail (Europe/Amsterdam kalenderdag `yyyy-MM-dd`);
   * max. 1× per dag per user.
   */
  lastDailyChatPromptDay?: string;
  reactionNudges?: ReactionNudge[];
  passwordResetToken?: string;
  passwordResetExpiresAt?: string;
  /** Live extracted user facts from chats (relationship, kids, work, birthday, ...). */
  personalFacts?: UserPersonalFacts;
  /**
   * Platform-welcome onboarding na eerste login (`null` = nog niet afgerond).
   * Ontbreekt het veld → bestaande accounts vóór deze feature (geen onboarding).
   */
  platformOnboardingCompletedAt?: string | null;
  /** Swift Visit Log / affiliate click_id uit landing URL (?click_id=...). */
  clickId?: string;
};

export type ReactionNudge = {
  profileId: string;
  source: "profile_like" | "post_like";
  fireAt: string;
  sentAt?: string;
};

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, 64);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function load(): Promise<UserRecord[]> {
  return readJsonBlob<UserRecord[]>(FILE, []);
}

async function save(list: UserRecord[]): Promise<void> {
  await writeJsonBlob(FILE, list);
}

export async function listUsers(): Promise<UserRecord[]> {
  return load();
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const e = email.trim().toLowerCase();
  const list = await load();
  return list.find((u) => u.email === e) ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const list = await load();
  return list.find((u) => u.id === id) ?? null;
}

export type CreateUserInput = {
  email: string;
  naam: string;
  leeftijd: number;
  password: string;
  discreetAkkoord: boolean;
  voorwaardenAkkoord: boolean;
  zoekLeeftijdCategorie?: string;
  zoekEigenschappen?: string[];
  geschatteMatches?: number;
  clickId?: string;
};

export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(email)) {
    throw new Error("Dit e-mailadres is al geregistreerd. Log in.");
  }
  const createdAt = new Date().toISOString();
  const user: UserRecord = {
    id: randomUUID(),
    email,
    naam: input.naam.trim(),
    leeftijd: input.leeftijd,
    passwordHash: hashPassword(input.password),
    discreetAkkoord: input.discreetAkkoord,
    voorwaardenAkkoord: input.voorwaardenAkkoord,
    createdAt,
    emailVerifiedAt: createdAt,
    engagementSlots: await resolveEngagementSlotsForNewUser(createdAt),
    ...(input.zoekLeeftijdCategorie
      ? { zoekLeeftijdCategorie: input.zoekLeeftijdCategorie }
      : {}),
    ...(input.zoekEigenschappen?.length
      ? { zoekEigenschappen: input.zoekEigenschappen }
      : {}),
    ...(typeof input.geschatteMatches === "number"
      ? { geschatteMatches: input.geschatteMatches }
      : {}),
    ...(input.clickId && input.clickId.trim() ? { clickId: input.clickId.trim() } : {}),
    platformOnboardingCompletedAt: null,
  };
  const list = await load();
  list.push(user);
  await save(list);
  await upsertAppUserToSupabaseUsers(user);
  return user;
}

export function toPublicUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    naam: u.naam,
    leeftijd: u.leeftijd,
    createdAt: u.createdAt,
    emailVerified: Boolean(u.emailVerifiedAt),
    hasCreditPurchase: Boolean(u.firstCreditPurchaseAt),
    /** Alleen `null` = nieuw account, onboarding nog niet gedaan. Ontbrekend veld = legacy gebruiker. */
    needsPlatformOnboarding: u.platformOnboardingCompletedAt === null,
  };
}

export async function completePlatformOnboarding(userId: string): Promise<UserRecord | null> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return null;
  const next = { ...list[i]!, platformOnboardingCompletedAt: new Date().toISOString() };
  list[i] = next;
  await save(list);
  await upsertAppUserToSupabaseUsers(next);
  return next;
}

export async function verifyUserEmailByToken(token: string): Promise<UserRecord | null> {
  const t = token.trim();
  if (!t) return null;
  const list = await load();
  const i = list.findIndex((u) => u.emailVerifyToken === t);
  if (i === -1) return null;
  const user = list[i]!;
  if (user.emailVerifiedAt) return user;
  const next = {
    ...user,
    emailVerifiedAt: new Date().toISOString(),
    emailVerifyToken: undefined,
  };
  list[i] = next;
  await save(list);
  await upsertAppUserToSupabaseUsers(next);
  return next;
}

export async function ensureUserEmailVerifyToken(userId: string): Promise<string | null> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return null;
  const user = list[i]!;
  if (user.emailVerifiedAt) return null;
  const token = user.emailVerifyToken?.trim() || randomUUID();
  if (user.emailVerifyToken !== token) {
    list[i] = { ...user, emailVerifyToken: token };
    await save(list);
  }
  return token;
}

export async function updateUserEmailForVerification(
  userId: string,
  nextEmailRaw: string
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const nextEmail = nextEmailRaw.trim().toLowerCase();
  if (!nextEmail) return { ok: false, reason: "E-mail is verplicht." };
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);
  if (!emailOk) return { ok: false, reason: "Vul een geldig e-mailadres in." };

  const list = await load();
  const userIndex = list.findIndex((u) => u.id === userId);
  if (userIndex === -1) return { ok: false, reason: "Gebruiker niet gevonden." };

  const duplicate = list.find((u) => u.email === nextEmail && u.id !== userId);
  if (duplicate) {
    return { ok: false, reason: "Dit e-mailadres is al in gebruik." };
  }

  const user = list[userIndex]!;
  if (user.emailVerifiedAt) {
    return { ok: false, reason: "E-mail is al geverifieerd." };
  }

  const token = randomUUID();
  list[userIndex] = {
    ...user,
    email: nextEmail,
    emailVerifyToken: token,
    emailVerifiedAt: undefined,
  };
  await save(list);
  return { ok: true, token };
}

export async function isUserEmailVerified(userId: string): Promise<boolean> {
  void userId;
  return true;
}

export async function updateUserEngagementSlots(
  userId: string,
  slots: EngagementSlot[]
): Promise<void> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return;
  list[i] = { ...list[i]!, engagementSlots: slots };
  await save(list);
}

export async function updateUserReactionNudges(
  userId: string,
  nudges: ReactionNudge[]
): Promise<void> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return;
  list[i] = { ...list[i]!, reactionNudges: nudges };
  await save(list);
}

export async function updateUserEngagementOutboundLog(
  userId: string,
  log: NonNullable<UserRecord["engagementOutboundLog"]>
): Promise<void> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return;
  const user = list[i]!;
  list[i] = { ...user, engagementOutboundLog: log };
  await save(list);
  await upsertAppUserToSupabaseUsers(list[i]!);
}

export async function updateUserLastDailyChatPromptDay(userId: string, day: string): Promise<void> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return;
  list[i] = { ...list[i]!, lastDailyChatPromptDay: day.trim() };
  await save(list);
  await upsertAppUserToSupabaseUsers(list[i]!);
}

export async function markCreditPurchase(userId: string): Promise<boolean> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return false;
  const u = list[i]!;
  if (u.firstCreditPurchaseAt) return false;
  list[i] = { ...u, firstCreditPurchaseAt: new Date().toISOString() };
  await save(list);
  await upsertAppUserToSupabaseUsers(list[i]!);
  return true;
}

/** Minimale interval tussen lastSeenAt-writes om Supabase blob I/O te beperken. */
const TOUCH_SEEN_MIN_MS = 120_000;

export async function touchUserSeen(userId: string): Promise<void> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return;
  const prev = list[i]!.lastSeenAt;
  if (prev) {
    const delta = Date.now() - new Date(prev).getTime();
    if (delta >= 0 && delta < TOUCH_SEEN_MIN_MS) return;
  }
  list[i] = { ...list[i]!, lastSeenAt: new Date().toISOString() };
  await save(list);
}

/** Offline nieuw-bericht / cadeau-mail: niet vaker dan 1× per uur per account. */
export const INBOX_NOTIFICATION_EMAIL_MIN_INTERVAL_MS = 60 * 60 * 1000;

export function canSendInboxNotificationEmail(user: UserRecord | null): boolean {
  if (!user?.email) return false;
  const last = user.lastInboxNotificationEmailAt;
  if (!last) return true;
  return Date.now() - new Date(last).getTime() >= INBOX_NOTIFICATION_EMAIL_MIN_INTERVAL_MS;
}

export async function touchLastInboxNotificationEmail(userId: string): Promise<void> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return;
  list[i] = {
    ...list[i]!,
    lastInboxNotificationEmailAt: new Date().toISOString(),
  };
  await save(list);
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export type PasswordResetRequestResult = {
  token: string;
  email: string;
  naam: string;
};

/** Maakt reset-token aan. Retourneert null als e-mail niet bestaat. */
export async function createPasswordResetRequest(
  emailRaw: string
): Promise<PasswordResetRequestResult | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return null;
  const user = await findUserByEmail(email);
  if (!user) return null;
  const token = randomUUID();
  const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
  const list = await load();
  const i = list.findIndex((u) => u.id === user.id);
  if (i === -1) return null;
  list[i] = {
    ...list[i]!,
    passwordResetToken: token,
    passwordResetExpiresAt: expires,
  };
  await save(list);
  return { token, email: user.email, naam: user.naam };
}

export async function completePasswordReset(
  tokenRaw: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = tokenRaw.trim();
  if (!token) return { ok: false, error: "Ongeldige link." };
  if (newPassword.length < 8) {
    return { ok: false, error: "Kies een wachtwoord van minimaal 8 tekens." };
  }
  const list = await load();
  const i = list.findIndex((u) => u.passwordResetToken === token);
  if (i === -1) {
    return { ok: false, error: "Ongeldige of verlopen link. Vraag een nieuwe aan." };
  }
  const user = list[i]!;
  const exp = user.passwordResetExpiresAt
    ? new Date(user.passwordResetExpiresAt).getTime()
    : 0;
  if (!exp || Date.now() > exp) {
    list[i] = {
      ...user,
      passwordResetToken: undefined,
      passwordResetExpiresAt: undefined,
    };
    await save(list);
    return { ok: false, error: "Deze link is verlopen. Vraag een nieuwe aan." };
  }
  const passwordHash = hashPassword(newPassword);
  list[i] = {
    ...user,
    passwordHash,
    passwordResetToken: undefined,
    passwordResetExpiresAt: undefined,
  };
  await save(list);
  await upsertAppUserToSupabaseUsers(list[i]!);
  return { ok: true };
}

export async function updateUserPersonalFacts(
  userId: string,
  patch: Partial<UserPersonalFacts>
): Promise<UserRecord | null> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return null;
  const current = list[i]!;
  const merged = mergePersonalFacts(current.personalFacts, patch);
  if (!merged) return current;
  const next: UserRecord = { ...current, personalFacts: merged };
  list[i] = next;
  await save(list);
  await upsertAppUserToSupabaseUsers(next);
  return next;
}
