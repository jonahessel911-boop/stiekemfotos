import { getClientClickIdForCheckout, persistClientClickId } from "@/lib/clickflare-client";

export type StartCheckoutPath = "/start" | "/start/2" | "/start/3" | "/start/4" | "/start/5";

export async function startOntmoetjongensCheckout(
  path: StartCheckoutPath,
  email: string
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Checkout kan alleen in de browser.");
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Vul een geldig e-mailadres in.");
  }

  const returnUrl = `${window.location.origin}${path}`;
  const clickId = getClientClickIdForCheckout();
  if (clickId) persistClientClickId(clickId);

  const leadRes = await fetch("/api/start/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email: cleanEmail, startPath: path, clickId }),
  });
  const leadData = (await leadRes.json()) as { error?: string };
  if (!leadRes.ok) {
    throw new Error(leadData.error || "E-mail opslaan mislukt");
  }

  const res = await fetch("/api/stripe/ontmoetjongens-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ returnUrl, clickId, email: cleanEmail, startPath: path }),
  });

  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error || "Account voltooien mislukt");
  }

  window.location.assign(data.url);
}
