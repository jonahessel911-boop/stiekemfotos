import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { readJson, writeJson } from "@/lib/server/store";

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

function load(): UserRecord[] {
  return readJson<UserRecord[]>(FILE, []);
}

function save(list: UserRecord[]) {
  writeJson(FILE, list);
}

export function findUserByEmail(email: string): UserRecord | null {
  const e = email.trim().toLowerCase();
  return load().find((u) => u.email === e) ?? null;
}

export function findUserById(id: string): UserRecord | null {
  return load().find((u) => u.id === id) ?? null;
}

export type CreateUserInput = {
  email: string;
  naam: string;
  leeftijd: number;
  password: string;
  discreetAkkoord: boolean;
  voorwaardenAkkoord: boolean;
};

export function createUser(input: CreateUserInput): UserRecord {
  const email = input.email.trim().toLowerCase();
  if (findUserByEmail(email)) {
    throw new Error("Dit e-mailadres is al geregistreerd. Log in.");
  }
  const user: UserRecord = {
    id: randomUUID(),
    email,
    naam: input.naam.trim(),
    leeftijd: input.leeftijd,
    passwordHash: hashPassword(input.password),
    discreetAkkoord: input.discreetAkkoord,
    voorwaardenAkkoord: input.voorwaardenAkkoord,
    createdAt: new Date().toISOString(),
  };
  const list = load();
  list.push(user);
  save(list);
  return user;
}

export function toPublicUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    naam: u.naam,
    leeftijd: u.leeftijd,
    createdAt: u.createdAt,
  };
}
