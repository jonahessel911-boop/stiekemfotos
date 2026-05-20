export const START_LEAD_EMAIL_KEY = "ontmoetjongens_start_email";

export function readStoredStartEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(START_LEAD_EMAIL_KEY)?.trim().toLowerCase() ?? "";
  } catch {
    return "";
  }
}

export function storeStartEmail(email: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(START_LEAD_EMAIL_KEY, email.trim().toLowerCase());
  } catch {
    /* best effort */
  }
}
