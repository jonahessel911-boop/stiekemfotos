import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import {
  resolveEngagementSlotsForNewUser,
  type EngagementSlot,
} from "@/lib/server/engagementSlots";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
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
  /** Ontmoetjongens /start-betaling (€19,95) voltooid. */
  ontmoetjongensPaidAt?: string;
  /** Wanneer abandonment-korting-mail verstuurd mag worden (1 uur na start-lead). */
  abandonmentOfferDueAt?: string;
  /** Abandonment-mail met 62% korting verstuurd. */
  abandonmentOfferEmailSentAt?: string;
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

type SupabaseUsersRow = {
  id: string;
  email: string;
  naam: string;
  leeftijd: number;
  password_hash: string;
  discreet_akkoord: boolean;
  voorwaarden_akkoord: boolean;
  email_verify_token?: string | null;
  email_verified_at?: string | null;
  first_credit_purchase_at?: string | null;
  created_at?: string;
  click_id?: string | null;
};

function userRecordFromSupabaseRow(row: SupabaseUsersRow): UserRecord {
  return {
    id: row.id,
    email: row.email.trim().toLowerCase(),
    naam: row.naam,
    leeftijd: row.leeftijd,
    passwordHash: row.password_hash,
    discreetAkkoord: Boolean(row.discreet_akkoord),
    voorwaardenAkkoord: Boolean(row.voorwaarden_akkoord),
    createdAt: row.created_at ?? new Date().toISOString(),
    ...(row.email_verify_token ? { emailVerifyToken: row.email_verify_token } : {}),
    ...(row.email_verified_at ? { emailVerifiedAt: row.email_verified_at } : {}),
    ...(row.first_credit_purchase_at
      ? { firstCreditPurchaseAt: row.first_credit_purchase_at }
      : {}),
    ...(row.click_id ? { clickId: row.click_id } : {}),
  };
}

const SUPABASE_USER_SELECT =
  "id,email,naam,leeftijd,password_hash,discreet_akkoord,voorwaarden_akkoord,email_verify_token,email_verified_at,first_credit_purchase_at,created_at,click_id";

/** Blob eerst (volledige velden); anders public.users in Supabase (admin-lijst). */
export async function loadUserFromSupabaseById(id: string): Promise<UserRecord | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("users")
    .select(SUPABASE_USER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return userRecordFromSupabaseRow(data as SupabaseUsersRow);
}

export async function loadUserFromSupabaseByEmail(email: string): Promise<UserRecord | null> {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("users")
    .select(SUPABASE_USER_SELECT)
    .eq("email", clean)
    .maybeSingle();
  if (error || !data) return null;
  return userRecordFromSupabaseRow(data as SupabaseUsersRow);
}

/** Voor e-mail/API: blob heeft voorrang (o.a. ontmoetjongensPaidAt, abandonment). */
export async function resolveAppUserById(userId: string): Promise<UserRecord | null> {
  const fromBlob = await findUserById(userId);
  if (fromBlob) return fromBlob;
  return loadUserFromSupabaseById(userId);
}

export async function resolveAppUserByEmail(email: string): Promise<UserRecord | null> {
  const fromBlob = await findUserByEmail(email);
  if (fromBlob) return fromBlob;
  return loadUserFromSupabaseByEmail(email);
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
    /** Onboarding-overlay is verwijderd; flag blijft hier puur voor backwards compat. */
    needsPlatformOnboarding: false,
  };
}

/** Eerste click_id bewaren (niet overschrijven) — voor ClickFlare bij latere betaling. */
export async function persistClickIdOnUser(
  userId: string,
  clickId: string | undefined
): Promise<UserRecord | null> {
  const id = clickId?.trim();
  if (!id) return findUserById(userId);
  const user = await findUserById(userId);
  if (!user) return null;
  if (user.clickId?.trim()) return user;
  return patchUserRecord(userId, { clickId: id });
}

export async function patchUserRecord(
  userId: string,
  patch: Partial<UserRecord>
): Promise<UserRecord | null> {
  const list = await load();
  let i = list.findIndex((u) => u.id === userId);
  if (i === -1) {
    const resolved = await loadUserFromSupabaseById(userId);
    if (!resolved) return null;
    const next = { ...resolved, ...patch };
    list.push(next);
    await save(list);
    await upsertAppUserToSupabaseUsers(next);
    return next;
  }
  const next = { ...list[i]!, ...patch };
  list[i] = next;
  await save(list);
  await upsertAppUserToSupabaseUsers(next);
  return next;
}

export async function markOntmoetjongensPaidForUser(userId: string): Promise<UserRecord | null> {
  const list = await load();
  const i = list.findIndex((u) => u.id === userId);
  if (i === -1) return null;
  if (list[i]!.ontmoetjongensPaidAt) return list[i]!;
  const next = {
    ...list[i]!,
    ontmoetjongensPaidAt: new Date().toISOString(),
    abandonmentOfferDueAt: undefined,
  };
  list[i] = next;
  await save(list);
  await upsertAppUserToSupabaseUsers(next);
  return next;
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
/** Eerste platformtoegang na betaling — langere geldigheid dan vergeten-wachtwoord. */
export const PLATFORM_SETUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PasswordResetRequestResult = {
  token: string;
  email: string;
  naam: string;
};

/** Maakt reset-token aan. Retourneert null als e-mail niet bestaat. */
export async function createPasswordResetRequest(
  emailRaw: string,
  options?: { ttlMs?: number }
): Promise<PasswordResetRequestResult | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) return null;
  const user = await resolveAppUserByEmail(email);
  if (!user) return null;
  const token = randomUUID();
  const ttl = options?.ttlMs ?? PASSWORD_RESET_TTL_MS;
  const expires = new Date(Date.now() + ttl).toISOString();
  const patched = await patchUserRecord(user.id, {
    passwordResetToken: token,
    passwordResetExpiresAt: expires,
  });
  if (!patched) return null;
  return { token, email: patched.email, naam: patched.naam };
}

/** Link voor eerste platformbezoek (na betaling / toegangs-mail). */
export async function createPlatformSetupRequest(
  emailRaw: string
): Promise<PasswordResetRequestResult | null> {
  return createPasswordResetRequest(emailRaw, { ttlMs: PLATFORM_SETUP_TOKEN_TTL_MS });
}

export async function findUserByPasswordResetToken(
  tokenRaw: string
): Promise<UserRecord | null> {
  const token = tokenRaw.trim();
  if (!token) return null;
  const list = await load();
  return list.find((u) => u.passwordResetToken === token) ?? null;
}

export async function completePasswordReset(
  tokenRaw: string,
  newPassword: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
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
  return { ok: true, userId: list[i]!.id };
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
