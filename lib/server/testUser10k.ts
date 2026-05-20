import { upsertAppUserToSupabaseUsers } from "@/lib/server/supabaseUserSync";
import type { UserRecord } from "@/lib/server/users";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import {
  TEST_USER_10K_EMAIL,
  TEST_USER_10K_ID,
} from "@/lib/test-user-10k";

const USERS_FILE = "users.json";

/** Zelfde hash als supabase/seed-test-user-10k-credits.sql */
const PASSWORD_HASH =
  "0123456789abcdef0123456789abcdef:70856528405e6123e1231d8d77ca64538692cebf74dab5ac24fdd814a7875193f41d66e07db59d5e4489bdc0d428de41b967fbf8b0235e074b9e9f73692cbc36";

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
  const i = list.findIndex(
    (u) => u.id === TEST_USER_10K_ID || u.email.toLowerCase() === TEST_USER_10K_EMAIL
  );

  const next: UserRecord = {
    id: TEST_USER_10K_ID,
    email: TEST_USER_10K_EMAIL,
    naam: "Test 10k credits",
    leeftijd: 30,
    passwordHash: PASSWORD_HASH,
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
