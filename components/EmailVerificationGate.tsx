"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { getStoredUser, setStoredUser } from "@/lib/onboarding-client";

type MeResponse = {
  user?: { emailVerified?: boolean; email?: string } | null;
};

function shouldSkipPath(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/inloggen") ||
    pathname.startsWith("/wachtwoord-vergeten") ||
    pathname.startsWith("/wachtwoord-reset") ||
    pathname.startsWith("/start") ||
    pathname.startsWith("/korting") ||
    pathname.startsWith("/lander") ||
    pathname.startsWith("/voorwaarden") ||
    pathname.startsWith("/admin")
  );
}

export default function EmailVerificationGate() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const skip = useMemo(() => shouldSkipPath(pathname), [pathname]);

  useEffect(() => {
    if (skip) {
      setOpen(false);
      return;
    }
    let cancel = false;
    const check = async () => {
      try {
        const r = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        const d = (await r.json()) as MeResponse;
        if (cancel) return;
        const needsVerify = Boolean(d.user && d.user.emailVerified === false);
        setOpen(needsVerify);
        if (needsVerify && d.user?.email) {
          setEmailInput((prev) => prev || String(d.user?.email ?? ""));
        }
      } catch {
        if (!cancel) setOpen(false);
      }
    };
    void check();
    const POLL_MS = 90_000;
    const id = window.setInterval(() => void check(), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancel = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [skip]);

  useEffect(() => {
    if (!open || skip) return;
    try {
      const key = "dm-submit-application-email-verify-gate";
      if (window.sessionStorage.getItem(key) === "1") return;
      const href = window.location.href;
      const referrer = document.referrer || undefined;
      const su = getStoredUser();
      const normalizedEmail = su?.email?.trim().toLowerCase();
      const w = window as Window & { ttq?: { track?: (e: string) => void } };
      w.ttq?.track?.("SubmitApplication");
      const payload = JSON.stringify({
        event: "SubmitApplication" as const,
        url: href || undefined,
        referrer,
        ...(normalizedEmail ? { email: normalizedEmail } : {}),
      });
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/tiktok/track", new Blob([payload], { type: "application/json" }));
      } else {
        void fetch("/api/tiktok/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
      window.sessionStorage.setItem(key, "1");
    } catch {
      // best effort
    }
  }, [open, skip]);

  useEffect(() => {
    if (!open || skip) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyTouchAction = body.style.touchAction;
    const prevBodyOverscrollBehavior = body.style.overscrollBehavior;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    body.style.overscrollBehavior = "none";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.touchAction = prevBodyTouchAction;
      body.style.overscrollBehavior = prevBodyOverscrollBehavior;
    };
  }, [open, skip]);

  const resendVerification = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/resend-verification", {
        method: "POST",
        credentials: "include",
      });
      const d = (await r.json()) as { error?: string; alreadyVerified?: boolean };
      if (!r.ok) throw new Error(d.error || "Verificatiemail opnieuw sturen mislukt.");
      if (d.alreadyVerified) {
        setOpen(false);
        return;
      }
      setMessage("Verificatiemail opnieuw verstuurd. Check ook spam/promoties.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Opnieuw sturen mislukt.");
    } finally {
      setBusy(false);
    }
  };

  const updateEmailAndResend = async () => {
    const nextEmail = emailInput.trim().toLowerCase();
    if (!nextEmail) {
      setMessage("Vul eerst je e-mailadres in.");
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/resend-verification", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail }),
      });
      const d = (await r.json()) as { error?: string; email?: string };
      if (!r.ok) throw new Error(d.error || "Wijzigen en opnieuw versturen mislukt.");

      const existing = getStoredUser();
      if (existing) {
        setStoredUser({
          ...existing,
          email: d.email ?? nextEmail,
        });
      }

      setMessage("E-mail gewijzigd en verificatiemail opnieuw verstuurd. Controleer ook je spam e-mail.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Wijzigen en opnieuw versturen mislukt.");
    } finally {
      setBusy(false);
    }
  };

  if (!open || skip) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/45 backdrop-blur-[2px] p-4 flex items-center justify-center">
      <div className="bg-[var(--surface-card)] max-w-md w-full rounded-3xl border-2 border-gray-300/90 shadow-2xl p-6 md:p-8">
        <div className="flex justify-center mb-5">
          <Logo variant="hero" className="scale-90" />
        </div>
        <h2 className="text-xl font-bold text-center text-gray-900 mb-2">
          Verifieer je e-mail die je hebt gekregen
        </h2>
        <p className="text-sm text-center text-gray-600 mb-5">
          Je ziet het platform al op de achtergrond, maar pas na verificatie kun je chatten en alles gebruiken.
        </p>
        <p className="text-xs text-center text-gray-500 mb-4">
          Controleer ook je spam e-mail.
        </p>
        <label className="block mb-3">
          <span className="mb-1 block text-xs font-semibold text-gray-600">Wijzig e-mail</span>
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="jij@email.nl"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none ring-primary/20 focus:border-primary focus:ring-2"
            autoComplete="email"
            disabled={busy}
          />
        </label>
        {message ? (
          <p className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void updateEmailAndResend()}
          disabled={busy}
          className="mb-3 w-full py-3 rounded-2xl border border-primary/30 bg-white text-primary font-bold text-sm hover:bg-primary/5 disabled:opacity-60"
        >
          {busy ? "Even geduld..." : "Wijzig e-mail en verstuur opnieuw"}
        </button>
        <button
          type="button"
          onClick={() => void resendVerification()}
          disabled={busy}
          className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-lg shadow-primary/25 hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? "Even geduld..." : "Verificatiemail opnieuw sturen"}
        </button>
      </div>
    </div>
  );
}
