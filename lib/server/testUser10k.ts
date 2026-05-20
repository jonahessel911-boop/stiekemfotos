import { upsertAppUserToSupabaseUsers } from "@/lib/server/supabaseUserSync";
import type { UserRecord } from "@/lib/server/users";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import {
  TEST_USER_10K_EMAIL,
  TEST_USER_10K_ID,
  TEST_USER_10K_LEGACY_EMAIL,
  TEST_USER_10K_PASSWORD_HASH,
} from "@/lib/test-user-10k";

const USERS_FILE = "users.json";

async function loadUsers(): Promise<UserRecord[]> {
  return readJsonBlob<UserRecord[]>(USERS_FILE, []);
}

async function saveUsers(list: UserRecord[]): Promise<void> {
  await writeJsonBlob(USERS_FILE, list);
}

/**
 * Zorgt dat het 10k-testaccount in users.json staat (app-login).
 * Supabase-ledger apart via seed-test-user-10k-credits.sql.
 */
export async function upsertTestUser10kCredits(): Promise<UserRecord> {
  const list = await loadUsers();
  const now = new Date().toISOString();
  const legacyEmail = TEST_USER_10K_LEGACY_EMAIL.toLowerCase();
  const i = list.findIndex(
    (u) =>
      u.id === TEST_USER_10K_ID ||
      u.email.toLowerCase() === TEST_USER_10K_EMAIL ||
      u.email.toLowerCase() === legacyEmail
  );

  const next: UserRecord = {
    id: TEST_USER_10K_ID,
    email: TEST_USER_10K_EMAIL,
    naam: "Jona test",
    leeftijd: 30,
    passwordHash: TEST_USER_10K_PASSWORD_HASH,
    discreetAkkoord: true,
    voorwaardenAkkoord: true,
    createdAt: i === -1 ? now : list[i]!.createdAt,
    emailVerifiedAt: now,
    ontmoetjongensPaidAt: list[i]?.ontmoetjongensPaidAt ?? now,
    platformOnboardingCompletedAt: now,
  };

  if (i === -1) {
    list.push(next);
  } else {
    list[i] = { ...list[i]!, ...next };
  }

  await saveUsers(list);
  await upsertAppUserToSupabaseUsers(next);
  return next;
}
