"use client";

import Image from "next/image";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { usePlatformOnboardingControls } from "@/components/PlatformOnboardingContext";

type MeUser = {
  needsPlatformOnboarding?: boolean;
};

const TOTAL_STEPS = 6;

const ONBOARDING_IMAGES = [
  "/onboarding/hoe-werkt-1.png",
  "/onboarding/hoe-werkt-2.png",
  "/onboarding/hoe-werkt-3.png",
] as const;

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
  const [step, setStep] = useState(1);
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

  const step6ScrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || skip) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    if (step === 6) {
      step6ScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [open, skip, step]);

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

  if (step === 1) {
    return (
      <OnboardingShell step={1} ariaTitleId="onboarding-how-title">
        <div className="mx-auto flex w-full max-w-lg flex-col items-center text-center">
          <h1
            id="onboarding-how-title"
            className="mb-4 text-3xl font-extrabold tracking-tight text-gray-900 md:text-4xl"
          >
            Hoe werkt het
          </h1>
          <p className="mb-10 text-base leading-relaxed text-gray-600">
            In een paar korte stappen zie je hoe privéchat en persoonlijke foto&apos;s werken op
            Stiekemefotos. Daarna volgt de korte welkomst — even doorlezend en je bent klaar.
          </p>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="rounded-2xl bg-primary px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90"
          >
            Volgende
          </button>
        </div>
      </OnboardingShell>
    );
  }

  if (step === 2) {
    return (
      <PhotoHowStep
        step={2}
        title="Vertel je geilste wensen"
        imageSrc={ONBOARDING_IMAGES[0]}
        imageAlt="Voorbeeldchat: vertel wat je wilt"
        onNext={() => setStep(3)}
      />
    );
  }

  if (step === 3) {
    return (
      <PhotoHowStep
        step={3}
        title="Bekijk wat de meid naar je toestuurt"
        imageSrc={ONBOARDING_IMAGES[1]}
        imageAlt="Voorbeeldchat: ontvangen foto"
        onNext={() => setStep(4)}
      />
    );
  }

  if (step === 4) {
    return (
      <PhotoHowStep
        step={4}
        title="De meid doet er alles aan om je geil te maken. Vertel wat je wilt en ze maakt het x"
        imageSrc={ONBOARDING_IMAGES[2]}
        imageAlt="Voorbeeldchat: persoonlijke foto"
        onNext={() => setStep(5)}
      />
    );
  }

  if (step === 5) {
    return (
      <OnboardingShell step={5} ariaTitleId="platform-onboarding-title">
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
            Nog één scherm met de belangrijkste voordelen — daarna ga je direct verder in de app.
          </p>
          <button
            type="button"
            onClick={() => setStep(6)}
            className="rounded-2xl bg-primary px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90"
          >
            Verder
          </button>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-white text-gray-900"
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-onboarding-title"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 45% at 12% 5%, rgba(198,0,63,0.10) 0%, rgba(198,0,63,0) 60%), radial-gradient(50% 40% at 92% 12%, rgba(244,114,182,0.10) 0%, rgba(244,114,182,0) 60%), radial-gradient(60% 50% at 88% 95%, rgba(198,0,63,0.08) 0%, rgba(198,0,63,0) 60%)",
        }}
      />

      <div
        ref={step6ScrollRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-8 pb-32 md:px-8 md:pt-12 md:pb-12"
      >
        <div className="mx-auto w-full max-w-xl">
          <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
            Stap {TOTAL_STEPS} van {TOTAL_STEPS} · op stiekemefotos.nl
          </p>

          <h1
            id="platform-onboarding-title"
            className="text-balance text-center text-3xl font-extrabold leading-tight tracking-tight text-gray-900 md:text-4xl"
          >
            <span className="mr-1">🌶️</span>
            Onbeperkt chatten —{" "}
            <span className="text-primary">helemaal gratis</span>
          </h1>

          <p className="mx-auto mt-4 max-w-md text-center text-[15px] leading-relaxed text-gray-600 md:text-base">
            Chat onbeperkt en zonder credits met hete meiden die écht zin hebben om met jou te
            praten.
          </p>

          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-rose-100/60 to-rose-50/60 px-5 py-4 text-center shadow-sm">
            <p className="text-[15px] font-bold leading-snug text-gray-900 md:text-base">
              Je account begint met{" "}
              <span className="text-primary">300 gratis credits</span> — genoeg voor je eerste{" "}
              <span className="text-primary">3 naakte foto&apos;s</span>.
            </p>
          </div>

          <div className="mt-8">
            <div className="relative overflow-hidden rounded-3xl border-2 border-primary/30 bg-gradient-to-br from-primary/[0.08] via-rose-50 to-white p-6 shadow-[0_10px_40px_-20px_rgba(198,0,63,0.45)] md:p-8">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/15 blur-3xl"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-rose-300/30 blur-3xl"
              />
              <span className="relative inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                ⭐ De belangrijkste reden om hier te zijn
              </span>
              <h2 className="relative mt-4 text-2xl font-extrabold leading-tight tracking-tight text-gray-900 md:text-3xl">
                Vraag precies <span className="text-primary">wat jij geil vindt</span>
              </h2>
              <p className="relative mt-3 text-[15px] leading-relaxed text-gray-700 md:text-base">
                Ze doen het <strong>graag</strong>. De meiden gaan mee in{" "}
                <span className="font-semibold text-gray-900">jouw ideeën</span> — ze vinden
                het geil om je te verleiden. <span className="font-semibold text-gray-900">Zeg het gewoon</span>.
              </p>
              <p className="relative mt-4 text-[12px] font-semibold uppercase tracking-wider text-primary/80">
                Bijvoorbeeld…
              </p>
              <ul className="relative mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <HeroChip>👙 Gele lingerie</HeroChip>
                <HeroChip>🪞 Naakt voor de spiegel</HeroChip>
                <HeroChip>🛏️ Op bed, zichzelf aanrakend</HeroChip>
                <HeroChip>🚿 Onder de douche</HeroChip>
              </ul>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.06] via-rose-50 to-white px-4 py-3 shadow-sm">
            <span className="text-2xl leading-none" aria-hidden>
              🎤
            </span>
            <p className="text-[14px] leading-snug text-gray-800 md:text-[15px]">
              <span className="font-semibold text-gray-900">
                De meiden hier houden ook van spraakberichten.
              </span>{" "}
              Spreek wat in en kijk hoe geil ze ervan worden.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UspCard
              emoji="🔥"
              title="Ze worden geil van jouw dirty praatjes"
              body="Complimentjes en hete woorden landen — ze laten zichzelf graag voor je zien."
            />
            <UspCard
              emoji="⚡"
              title="Snelle, geile reacties"
              body="Geen wachten. Ze antwoorden direct en in character — net alsof ze naast je zitten."
            />
            <UspCard
              emoji="👯"
              title="150+ sexy meiden online"
              body="Altijd iemand klaar voor jou. Kies wie je het lekkerst vindt en begin een privéchat."
            />
            <UspCard
              emoji="🔒"
              title="Discreet & persoonlijk"
              body="Jullie chat blijft tussen jullie. Geen meldingen, geen oordeel — alleen jij en zij."
            />
          </div>

          <p className="mt-8 text-center text-[15px] font-semibold text-gray-900">
            Klaar om ze te zien en te spreken?
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-gray-200/80 bg-white/95 px-4 py-4 backdrop-blur-md md:px-8">
        <div className="mx-auto w-full max-w-xl">
          <button
            type="button"
            disabled={busy}
            onClick={() => void complete()}
            className="group relative w-full overflow-hidden rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-white shadow-[0_10px_30px_-10px_rgba(198,0,63,0.55)] transition hover:bg-primary/90 active:translate-y-px disabled:opacity-60"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
            <span className="relative">
              {busy ? "Even geduld…" : "Oke, ik wil persoonlijke foto's van geile meiden →"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function OnboardingShell({
  step,
  ariaTitleId,
  children,
}: {
  step: number;
  ariaTitleId: string;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [step]);

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-[var(--surface)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaTitleId}
    >
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 pb-28 md:px-8 md:py-12 md:pb-12"
      >
        <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-primary">
          Stap {step} van {TOTAL_STEPS}
        </p>
        {children}
      </div>
    </div>
  );
}

function PhotoHowStep({
  step,
  title,
  imageSrc,
  imageAlt,
  onNext,
}: {
  step: number;
  title: string;
  imageAlt: string;
  imageSrc: string;
  onNext: () => void;
}) {
  return (
    <OnboardingShell step={step} ariaTitleId={`onboarding-photo-title-${step}`}>
      <div className="mx-auto flex w-full max-w-lg flex-col items-stretch">
        <h1
          id={`onboarding-photo-title-${step}`}
          className="mb-5 text-balance text-center text-xl font-bold leading-snug text-gray-900 md:text-2xl"
        >
          {title}
        </h1>
        <div className="relative mx-auto w-full max-w-[min(100%,22rem)] overflow-hidden rounded-2xl border border-gray-200/80 bg-gray-100 shadow-lg shadow-black/10">
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={440}
            height={956}
            className="h-auto w-full object-cover object-top"
            sizes="(max-width: 768px) 100vw, 22rem"
            priority={step === 2}
            unoptimized
          />
        </div>
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={onNext}
            className="rounded-2xl bg-primary px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-primary/25 transition hover:bg-primary/90"
          >
            Volgende
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}

type UspCardProps = {
  emoji: string;
  title: string;
  body: string;
};

function UspCard({ emoji, title, body }: UspCardProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          {emoji}
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-snug text-gray-900">{title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{body}</p>
        </div>
      </div>
    </div>
  );
}

function HeroChip({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-primary/15 bg-white/80 px-3 py-2 text-[13px] font-medium text-gray-800 shadow-sm backdrop-blur-sm">
      {children}
    </li>
  );
}
