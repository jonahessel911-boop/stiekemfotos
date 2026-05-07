import { createHmac, timingSafeEqual } from "crypto";

const ADMIN_EMAIL = "admin@admin.nl";
const ADMIN_PASSWORD = "1234";
const ADMIN_COOKIE_NAME = "dm_admin_session";
const ADMIN_MAX_AGE = 60 * 60 * 12;

function secret(): string {
  return process.env.SESSION_SECRET?.trim() || "dev-admin-secret-16-chars";
}

export function isValidAdminLogin(email: string, password: string): boolean {
  return email.trim().toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASSWORD;
}

export function createAdminCookieValue(): string {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ sub: "admin", exp }), "utf-8").toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function parseAdminCookieValue(value: string | undefined): boolean {
  if (!value?.includes(".")) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
      sub?: string;
      exp?: number;
    };
    return data.sub === "admin" && typeof data.exp === "number" && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export const ADMIN_SESSION_COOKIE_NAME = ADMIN_COOKIE_NAME;
export const ADMIN_SESSION_MAX_AGE = ADMIN_MAX_AGE;
