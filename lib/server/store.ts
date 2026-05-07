import fs from "fs";
import os from "os";
import path from "path";

/**
 * JSON + conv-images worden hier opgeslagen.
 * - Lokaal: ./data
 * - Vercel/serverless: onder os.tmpdir() (enige beschrijfbare plek; /var/task is read-only)
 *
 * Let op: op serverless is /tmp niet gedeeld tussen alle instances en kan worden geleegd.
 * Voor echte productie met veel gebruikers: database (bv. Neon) + object storage voor foto's.
 */
export function getDataDir(): string {
  const fromEnv = process.env.DATA_DIR?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  if (process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "discreetemeisjes-data");
  }
  return path.join(process.cwd(), "data");
}

export function ensureDataDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJson<T>(filename: string, fallback: T): T {
  ensureDataDir();
  const fp = path.join(getDataDir(), filename);
  if (!fs.existsSync(fp)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(filename: string, data: unknown) {
  ensureDataDir();
  const fp = path.join(getDataDir(), filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}
