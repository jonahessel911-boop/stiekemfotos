/** Client-side onboarding / sessie (geen e-mailverificatie) */

export const STORAGE_KEY = "dm_user_v1";

export type StoredUser = {
  id?: string;
  naam: string;
  email: string;
  leeftijd: number;
  discreetAkkoord: boolean;
  voorwaardenAkkoord: boolean;
  completedAt: string;
};

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: StoredUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasCompletedStartup(): boolean {
  return getStoredUser() !== null;
}
