import { getClientClickIdForCheckout, persistClientClickId } from "@/lib/clickflare-client";

export async function startKortingCheckout(email: string, returnUrl?: string): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Checkout kan alleen in de browser.");
  }

  const cleanEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error("Vul een geldig e-mailadres in.");
  }

  const resolvedReturn =
    returnUrl ?? `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const clickId = getClientClickIdForCheckout();
  if (clickId) persistClientClickId(clickId);

  const res = await fetch("/api/stripe/korting-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ returnUrl: resolvedReturn, clickId, email: cleanEmail }),
  });

  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error || "Checkout mislukt");
  }

  window.location.assign(data.url);
}
