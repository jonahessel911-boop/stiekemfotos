'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';

const CTA_URL = 'https://911-for-me.com/cf/click';

const CHATMATCH_VOORDELEN = [
  'Echte vrouwen op zoek naar mannelijk contact',
  'Leuke en spontane gesprekken',
  'Vrouwen reageren binnen enkele minuten',
  '87% van de chats leiden tot een afspraak',
  'Gratis aanmelden',
  'Veilig en discreet chatten',
] as const;

const ANDERE_NADELEN = [
  'Neppe profielen en bots',
  'Nauwelijks reacties',
  'Gesprekken stoppen snel',
  'Veel mannen, weinig actieve vrouwen',
  'Verborgen kosten',
  'Slechte gebruikerservaring',
] as const;

function OnlineDot({ pulse = false }: { pulse?: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {pulse && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      )}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
    </span>
  );
}

export default function Lander8Page() {
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: unknown };
        if (!cancel && d.user) {
          window.location.replace('/profielen');
          return;
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const show = window.setTimeout(() => setToastVisible(true), 2200);
    return () => window.clearTimeout(show);
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F0FA] text-gray-900 antialiased">
      <ClickFlareCapture />

      {/* Floating notification */}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-5 left-4 right-4 z-50 mx-auto max-w-sm transition-all duration-500 ease-out sm:left-auto sm:right-6 ${
          toastVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0'
        }`}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white px-4 py-3 shadow-[0_12px_40px_-12px_rgba(123,44,191,0.35)]">
          <OnlineDot pulse />
          <p className="text-sm font-medium text-gray-800">
            <span className="font-semibold text-[#7B2CBF]">Sofie</span> uit Amsterdam is nu online
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 pb-12 pt-8 sm:px-6 sm:pt-10">
        {/* Urgency pills */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#7B2CBF] shadow-sm ring-1 ring-[#7B2CBF]/10">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            Populair in Nederland
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7B2CBF]/10 px-3 py-1.5 text-xs font-semibold text-[#5a1f8f]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Veel nieuwe aanmeldingen vandaag
          </span>
        </div>

        {/* Header */}
        <header className="mb-8 text-center sm:mb-10">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#7B2CBF] shadow-sm">
            <OnlineDot pulse />
            Live vergelijking · {(2483).toLocaleString('nl-NL')}+ online
          </p>
          <h1 className="text-balance text-3xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-4xl md:text-[2.35rem]">
            Waarom kiezen steeds meer mannen voor{' '}
            <span className="text-[#7B2CBF]">ChatMatch</span>?
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base font-medium text-gray-600 sm:text-lg">
            Vergelijk zelf waarom duizenden mannen overstappen.
          </p>
        </header>

        {/* Comparison */}
        <div className="grid gap-4 md:grid-cols-2 md:gap-5">
          {/* ChatMatch */}
          <article className="group relative overflow-hidden rounded-[24px] border-2 border-[#7B2CBF]/25 bg-white p-5 shadow-[0_16px_48px_-20px_rgba(123,44,191,0.35)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_56px_-20px_rgba(123,44,191,0.4)] sm:p-6">
            <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              <OnlineDot pulse />
              Online nu
            </div>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7B2CBF] to-[#9d4edd] text-lg font-bold text-white shadow-md">
                CM
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">ChatMatch</h2>
                <p className="text-xs font-medium text-emerald-600">Aanbevolen keuze</p>
              </div>
            </div>
            <ul className="space-y-3.5">
              {CHATMATCH_VOORDELEN.map((item) => (
                <li key={item} className="flex gap-3 text-left text-sm leading-snug sm:text-[15px]">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <Check className="h-4 w-4 stroke-[2.5]" aria-hidden />
                  </span>
                  <span className="font-medium text-gray-800">{item}</span>
                </li>
              ))}
            </ul>
          </article>

          {/* Other platforms */}
          <article className="rounded-[24px] border border-gray-200/80 bg-white/90 p-5 shadow-[0_8px_32px_-16px_rgba(0,0,0,0.08)] transition-all duration-300 hover:border-gray-300 sm:p-6">
            <div className="mb-5 flex items-center gap-3 opacity-90">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-lg font-bold text-gray-400">
                ??
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-500">Andere platforms</h2>
                <p className="text-xs font-medium text-gray-400">Vaak teleurstellend</p>
              </div>
            </div>
            <ul className="space-y-3.5">
              {ANDERE_NADELEN.map((item) => (
                <li key={item} className="flex gap-3 text-left text-sm leading-snug sm:text-[15px]">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                    <X className="h-4 w-4 stroke-[2.5]" aria-hidden />
                  </span>
                  <span className="font-medium text-gray-500">{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>

        {/* CTA block */}
        <section className="mt-8 text-center sm:mt-10">
          <a
            href={CTA_URL}
            className="group inline-flex w-full max-w-md items-center justify-center gap-2 rounded-[24px] bg-[#7B2CBF] px-8 py-5 text-lg font-bold text-white shadow-[0_16px_40px_-8px_rgba(123,44,191,0.55)] transition-all duration-300 hover:bg-[#6a24a8] hover:shadow-[0_20px_48px_-8px_rgba(123,44,191,0.6)] active:scale-[0.98] sm:py-6 sm:text-xl"
          >
            Bekijk wie online is
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </a>
          <p className="mt-4 text-sm font-semibold text-gray-700">
            Meer dan{' '}
            <span className="tabular-nums text-[#7B2CBF]">2.483</span> vrouwen vandaag actief
          </p>

          {/* Trust */}
          <div className="mx-auto mt-8 flex max-w-md flex-col items-center gap-4 rounded-[24px] bg-white px-6 py-5 shadow-[0_8px_32px_-16px_rgba(123,44,191,0.15)] sm:flex-row sm:justify-center sm:gap-8">
            <div className="flex items-center gap-2">
              <div className="flex text-amber-400" aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`h-5 w-5 ${i < 4 ? 'fill-amber-400' : 'fill-amber-400/40'}`}
                  />
                ))}
              </div>
              <span className="text-sm font-bold text-gray-900">4,8/5</span>
              <span className="text-sm text-gray-500">beoordeling</span>
            </div>
            <div className="hidden h-8 w-px bg-gray-200 sm:block" />
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-5 w-5 text-[#7B2CBF]" aria-hidden />
              <span className="font-bold text-gray-900">12.000+</span>
              <span className="text-gray-500">actieve gebruikers</span>
            </div>
            <div className="hidden h-8 w-px bg-gray-200 sm:block" />
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Shield className="h-5 w-5 text-[#7B2CBF]" aria-hidden />
              <span className="font-medium">Veilig &amp; discreet</span>
            </div>
          </div>
        </section>

        <footer className="mt-10 text-center text-xs text-gray-500">
          18+ · Onafhankelijke vergelijking · Vertrouwen &amp; discretie
        </footer>
      </div>
    </div>
  );
}
