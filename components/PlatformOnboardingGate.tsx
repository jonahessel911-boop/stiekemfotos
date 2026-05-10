"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { usePlatformOnboardingControls } from "@/components/PlatformOnboardingContext";

type MeUser = {
  needsPlatformOnboarding?: boolean;
};

function shouldSkipPath(pathname: string): boolean {
  return (
    pathname.startsWith("/inloggen") ||
    pathname.startsWith("/wachtwoord-vergeten") ||
    pathname.startsWith("/wachtwoord-reset") ||
    pathname.startsWith("/start") ||
    pathname.startsWith("/voorwaarden") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/kwalificatie")
  );
}

export default function PlatformOnboardingGate() {
  const pathname = usePathname() ?? "/";
  const skip = useMemo(() => shouldSkipPath(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const { setPlatformOnboardingActive } = usePlatformOnboardingControls();

  useEffect(() => {
    if (skip) {
      setOpen(false);
      return;
    }
    let cancel = false;
    const check = async () => {
      try {
        const r = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        const d = (await r.json()) as { user?: MeUser | null };
        if (cancel) return;
        const u = d.user;
        setOpen(Boolean(u?.needsPlatformOnboarding));
        if (!u?.needsPlatformOnboarding) setStep(1);
      } catch {
        if (!cancel) setOpen(false);
      }
    };
    void check();
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancel = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [skip]);

  useEffect(() => {
    setPlatformOnboardingActive(Boolean(open && !skip));
  }, [open, skip, setPlatformOnboardingActive]);

  useEffect(() => {
    if (!open || skip) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [open, skip]);

  const complete = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/auth/platform-onboarding/complete", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) return;
      setOpen(false);
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  if (!open || skip) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--surface)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-onboarding-title"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 pb-28 md:px-8 md:py-12 md:pb-12">
        {step === 1 ? (
          <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
            <div className="relative mb-8 h-28 w-28 shrink-0 overflow-hidden rounded-full ring-4 ring-primary/30 shadow-xl shadow-primary/20">
              <Image
                src="/logo-stiekemefotos.png"
                alt=""
                width={112}
                height={112}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
              Stap 1 van 2
            </p>
            <h1
              id="platform-onboarding-title"
              className="mb-4 text-2xl font-bold tracking-tight text-gray-900 md:text-3xl"
            >
              Welkom op Stiekemefotos
            </h1>
            <p className="mb-3 text-base leading-relaxed text-gray-600">
              Hier chat je privé met echte profielen: onbeperkt praten, flirten en foto&apos;s
              ontgrendelen die ze speciaal voor jou maken. Credits gebruik je voor persoonlijke
              plaatjes — chatten zelf kost geen credits.
            </p>
            <p className="mb-10 text-sm leading-relaxed text-gray-500">
              Even door deze korte intro, daarna zie je wat je allemaal kunt verwachten op het
              platform.
            </p>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-2xl bg-primary px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90"
            >
              Verder
            </button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-lg pb-4">
            <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-primary">
              Stap 2 van 2
            </p>
            <p className="mb-6 text-center text-lg font-semibold text-gray-900">
              op stiekemefotos.nl
            </p>

            <div className="space-y-5 text-gray-800">
              <p className="text-lg font-bold leading-snug">
                🌶️ Onbeperkt chatten — zonder credits
              </p>
              <p className="leading-relaxed">
                Chat onbeperkt met hete meiden die écht zin hebben om met jou te praten (chatten
                kost geen credits).
              </p>
              <p className="leading-relaxed">
                Je account bevat 200 credits om mee te beginnen — genoeg om je eerste foto&apos;s te
                ontgrendelen.
              </p>
              <p className="leading-relaxed">
                Vraag haar om lingerie, een strak outfitje, naakt op bed, in de douche… of laat haar
                je verrassen. Jij beslist.
              </p>

              <ul className="list-none space-y-3 border-y border-gray-200 py-5 text-[15px] leading-relaxed">
                <li>Meer dan 150+ sexy meiden online</li>
                <li>Altijd iemand klaar voor jou</li>
                <li>Persoonlijke, spannende gesprekken</li>
                <li>De meiden houden van vieze praatjes én een echte klik</li>
                <li>Snelle, geile reacties — ze laten je niet wachten</li>
              </ul>

              <p className="pt-2 text-center text-lg font-semibold text-gray-900">
                Klaar om ze te zien en te spreken?
              </p>
            </div>
          </div>
        )}
      </div>

      {step === 2 ? (
        <div className="sticky bottom-0 border-t border-gray-200/80 bg-[var(--surface)]/95 px-4 py-4 backdrop-blur-md md:static md:border-0 md:bg-transparent md:py-0 md:backdrop-blur-none">
          <div className="mx-auto w-full max-w-lg">
            <button
              type="button"
              disabled={busy}
              onClick={() => void complete()}
              className="w-full rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? "Even geduld…" : "Oke, ik wil naar het platform →"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
