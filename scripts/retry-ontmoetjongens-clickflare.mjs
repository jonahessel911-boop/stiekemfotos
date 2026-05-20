#!/usr/bin/env node
/**
 * Handmatig ClickFlare postback voor een Ontmoetjongens Stripe session.
 * Gebruik: node scripts/retry-ontmoetjongens-clickflare.mjs cs_xxx [click_id]
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const sessionId = process.argv[2]?.trim();
const clickIdHint = process.argv[3]?.trim() || "";

if (!sessionId) {
  console.error("Usage: node scripts/retry-ontmoetjongens-clickflare.mjs <stripe_session_id> [click_id]");
  process.exit(1);
}

const base = process.env.SITE_URL || "http://localhost:3000";
const res = await fetch(`${base}/api/stripe/ontmoetjongens-conversion`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, clickId: clickIdHint }),
});

const data = await res.json();
console.log(res.status, JSON.stringify(data, null, 2));
process.exit(res.ok && data.sent ? 0 : 1);
