#!/usr/bin/env node
/**
 * Handmatig Ontmoetjongens afhandelen (user + ClickFlare) voor een betaalde Stripe session.
 * click_id wordt uit Stripe session metadata gehaald als je die niet meegeeft.
 *
 *   node scripts/retry-ontmoetjongens-clickflare.mjs cs_xxx
 *   node scripts/retry-ontmoetjongens-clickflare.mjs cs_xxx <click_id>
 *
 * Zet SITE_URL op productie (geen www als die niet in DNS staat):
 *   SITE_URL=https://stiekemefotos.nl node scripts/retry-ontmoetjongens-clickflare.mjs cs_xxx
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const sessionId = process.argv[2]?.trim();
const clickIdHint = process.argv[3]?.trim() || "";

if (!sessionId) {
  console.error(
    "Usage: node scripts/retry-ontmoetjongens-clickflare.mjs <stripe_session_id> [click_id]"
  );
  process.exit(1);
}

const base = (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");
const url = `${base}/api/stripe/ontmoetjongens-conversion`;

console.log(`POST ${url}`);
console.log(`sessionId=${sessionId}${clickIdHint ? ` clickId=${clickIdHint}` : ""}`);

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, clickId: clickIdHint }),
});

let data;
try {
  data = await res.json();
} catch {
  console.error(`HTTP ${res.status} — geen JSON (controleer SITE_URL en of de site bereikbaar is)`);
  process.exit(1);
}

console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(data, null, 2));

const ok =
  res.ok &&
  (data.sent === true ||
    data.reason === "already_sent" ||
    (data.userId && data.reason !== "postback_failed"));

if (!ok) {
  console.error("\nMislukt. Controleer: betaalde session, click_id in metadata, CLICKFLARE_* env op de server.");
  process.exit(1);
}

console.log("\nKlaar.", data.sent ? "ClickFlare postback verstuurd." : data.reason);
