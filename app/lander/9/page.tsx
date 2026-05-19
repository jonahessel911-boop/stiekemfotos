'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Loader2,
  MapPin,
  MessageCircle,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import { NL_MAP_VIEWBOX, PROVINCE_PATHS } from './province-paths';

const CTA_URL = 'https://911-for-me.com/cf/click';

const FLOATING_LABELS = [
  { text: 'Sofie is online', x: '12%', y: '18%', delay: '0s' },
  { text: 'Lisa reageerde net', x: '58%', y: '32%', delay: '1.2s' },
  { text: '3 vrouwen actief', x: '22%', y: '52%', delay: '2.4s' },
] as const;

function OnlineDot({ className = '' }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-2.5 w-2.5 ${className}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
    </span>
  );
}

export default function Lander9Page() {
  const hiddenOfferRef = useRef<HTMLAnchorElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  const selectedName = PROVINCE_PATHS.find((p) => p.id === selectedId)?.name;

  const goToOffer = useCallback(() => {
    hiddenOfferRef.current?.click();
  }, []);

  const selectProvince = useCallback(
    (id: string) => {
      if (loading) return;
      setSelectedId(id);
      setLoading(true);
      window.setTimeout(() => {
        goToOffer();
      }, 1600);
    },
    [loading, goToOffer]
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: unknown };
        if (!cancel && d.user) {
          window.location.replace('/profielen');
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
    const t = window.setTimeout(() => setToastVisible(true), 2500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F0FA] text-gray-900 antialiased">
      <ClickFlareCapture />

      <a
        ref={hiddenOfferRef}
        href={CTA_URL}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      >
        Offer
      </a>

      <div
        role="status"
        className={`fixed bottom-24 left-4 right-4 z-40 mx-auto max-w-sm transition-all duration-500 sm:bottom-8 sm:right-6 sm:left-auto ${
          toastVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <div className="flex items-center gap-3 rounded-2xl border border-white/90 bg-white px-4 py-3 shadow-[0_12px_40px_-12px_rgba(123,44,191,0.35)]">
          <OnlineDot />
          <p className="text-sm font-medium text-gray-800">Nieuwe vrouw online in jouw regio</p>
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#F4F0FA]/95 px-6 backdrop-blur-sm">
          <Loader2 className="h-12 w-12 animate-spin text-[#7B2CBF]" aria-hidden />
          <p className="mt-6 text-center text-lg font-bold text-gray-900">
            Vrouwen zoeken in jouw provincie…
          </p>
          {selectedName && (
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-[#7B2CBF]">
              <MapPin className="h-4 w-4" aria-hidden />
              {selectedName}
            </p>
          )}
        </div>
      )}

      <div className="mx-auto max-w-lg px-4 pb-10 pt-7 sm:max-w-xl sm:px-6 sm:pt-9">
        <div className="mb-5 flex flex-wrap justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#7B2CBF] shadow-sm">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            Populair in Nederland
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7B2CBF]/10 px-3 py-1.5 text-xs font-semibold text-[#5a1f8f]">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Vandaag 2.483 vrouwen actief
          </span>
        </div>

        <header className="mb-6 text-center">
          <h1 className="text-balance text-2xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-3xl">
            Selecteer de provincie waarin je vrouwen wilt ontmoeten
          </h1>
          <p className="mt-3 text-base font-medium text-gray-600">
            Bekijk welke vrouwen vandaag actief zijn in jouw regio.
          </p>
        </header>

        <div className="relative overflow-hidden rounded-[24px] border border-[#7B2CBF]/15 bg-white p-3 shadow-[0_16px_48px_-20px_rgba(123,44,191,0.3)] sm:p-4">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#7B2CBF]/5 to-transparent" />

          {FLOATING_LABELS.map((lbl) => (
            <div
              key={lbl.text}
              className="pointer-events-none absolute z-10 hidden animate-bounce rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-gray-800 shadow-md ring-1 ring-[#7B2CBF]/15 sm:block sm:text-xs"
              style={{
                left: lbl.x,
                top: lbl.y,
                animationDuration: '3s',
                animationDelay: lbl.delay,
              }}
            >
              <span className="flex items-center gap-1.5">
                <OnlineDot />
                {lbl.text}
              </span>
            </div>
          ))}

          <svg
            viewBox={NL_MAP_VIEWBOX}
            className="relative z-[1] mx-auto w-full max-w-[320px] touch-manipulation"
            role="img"
            aria-label="Kaart van Nederland — klik op een provincie"
          >
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {PROVINCE_PATHS.map((p) => {
              const active = selectedId === p.id || hoveredId === p.id;
              const fillClass = active
                ? 'fill-[#7B2CBF] stroke-[#5a1f8f]'
                : 'fill-[#C4B5FD] stroke-[#9d7cd4] hover:fill-[#9d4edd]';

              return (
                <g
                  key={p.id}
                  className="cursor-pointer transition-all duration-300"
                  style={active ? { filter: 'url(#glow)' } : undefined}
                  role="button"
                  tabIndex={0}
                  aria-label={p.name}
                  onClick={() => selectProvince(p.id)}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onTouchStart={() => setHoveredId(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectProvince(p.id);
                    }
                  }}
                >
                  {p.paths.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      className={`${fillClass} ${active ? 'animate-pulse' : ''}`}
                      strokeWidth={active ? 0.9 : 0.55}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                  <circle
                    cx={p.dot.x}
                    cy={p.dot.y}
                    r={2.2}
                    className="pointer-events-none fill-emerald-500 animate-ping"
                    opacity={0.7}
                  />
                  <circle
                    cx={p.dot.x}
                    cy={p.dot.y}
                    r={1.6}
                    className="pointer-events-none fill-emerald-500"
                  />
                </g>
              );
            })}
          </svg>

          <p className="relative z-[1] mt-2 text-center text-xs text-gray-500 sm:hidden">
            Tik op een provincie op de kaart
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROVINCE_PATHS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={loading}
              onClick={() => selectProvince(p.id)}
              className={`rounded-2xl border px-3 py-2.5 text-left text-sm font-semibold transition-all ${
                selectedId === p.id
                  ? 'border-[#7B2CBF] bg-[#7B2CBF] text-white shadow-md'
                  : 'border-gray-200 bg-white text-gray-800 hover:border-[#7B2CBF]/40 hover:bg-[#EDE7F6]'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        <section className="mt-6 text-center">
          <a
            href={CTA_URL}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-[24px] bg-[#7B2CBF] px-6 py-5 text-lg font-bold text-white shadow-[0_16px_40px_-8px_rgba(123,44,191,0.55)] transition-all hover:bg-[#6a24a8] active:scale-[0.98]"
          >
            Bekijk vrouwen in mijn provincie
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </a>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-medium text-gray-600">
            <span className="inline-flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-[#7B2CBF]" aria-hidden />
              Gratis aanmelden
            </span>
            <span className="inline-flex items-center gap-1">
              <Shield className="h-3.5 w-3.5 text-[#7B2CBF]" aria-hidden />
              Discreet chatten
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="h-3.5 w-3.5 text-[#7B2CBF]" aria-hidden />
              Direct chatten
            </span>
          </div>
        </section>

        <footer className="mt-8 text-center text-xs text-gray-500">
          18+ · Vertrouwen &amp; discretie
        </footer>
      </div>
    </div>
  );
}
