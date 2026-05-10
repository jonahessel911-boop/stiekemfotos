#!/usr/bin/env node
/**
 * Leest `.env.local` en zet elke regel KEY=waarde op Vercel (production + preview).
 * Waarde gaat via stdin naar `vercel env add` (niet zichtbaar in ps aux).
 *
 * Gebruik: node scripts/push-env-to-vercel.mjs
 * Vereist: `npx vercel login` en gekoppeld project (.vercel/project.json).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.local");
/** Preview vereist soms een Git-branch in het CLI; daarom standaard alleen Production. */
const TARGETS = ["production"];

function parseDotenvLocal(raw) {
  const out = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1).replace(/\\n/g, "\n");
    }
    if (val === "") continue;
    out.push({ key, val });
  }
  return out;
}

function vercelEnvAdd(key, targetEnv, value) {
  const r = spawnSync(
    "npx",
    ["--yes", "vercel@latest", "env", "add", key, targetEnv, "--yes", "--force"],
    {
      cwd: ROOT,
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    }
  );
  const err = (r.stderr || "").trim();
  const out = (r.stdout || "").trim();
  return { status: r.status ?? 1, err, out };
}

if (!fs.existsSync(ENV_FILE)) {
  console.error("Geen .env.local gevonden naast package.json.");
  process.exit(1);
}

const raw = fs.readFileSync(ENV_FILE, "utf8");
const pairs = parseDotenvLocal(raw).filter((p) => p.val.length > 0);

if (pairs.length === 0) {
  console.error("Geen KEY=waarde regels met inhoud in .env.local.");
  process.exit(1);
}

console.log(`${pairs.length} variabelen gevonden — pushen naar ${TARGETS.join(", ")}…`);

let failures = 0;
for (const { key, val } of pairs) {
  for (const env of TARGETS) {
    const { status, err } = vercelEnvAdd(key, env, val);
    if (status !== 0) {
      failures++;
      console.error(`✗ ${key} (${env})`);
      if (err) console.error(err);
    } else {
      console.log(`✓ ${key} (${env})`);
    }
  }
}

if (failures > 0) {
  console.error(`\nKlaar met ${failures} fout(en).`);
  process.exit(1);
}
console.log("\nAlle variabelen gezet. Deploy opnieuw op Vercel zodat NEXT_PUBLIC_* meekomen in de build.");
