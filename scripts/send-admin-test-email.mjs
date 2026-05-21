import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  /* .env.local optional */
}

const { sendAdminNewUserMessageEmail, getAdminNotifyEmail } = await import(
  "../lib/server/email.ts"
);

const to = getAdminNotifyEmail();
await sendAdminNewUserMessageEmail({
  to,
  profileName: "Marcin",
  userName: "jona (test)",
  userEmail: "jona@gmail.com",
  preview: "Dit is een test — admin notificatie werkt.",
  conversationId: "test-conversation-id",
});
console.log("OK: testmail verstuurd naar", to);
