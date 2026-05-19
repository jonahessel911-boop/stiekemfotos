'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Loader2,
  Lock,
  MessageCircle,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';

const CTA_URL = 'https://911-for-me.com/cf/click';

const BLURRED_PROFILES = [
  {
    id: 'sofie',
    name: 'Sofie',
    age: 28,
    city: 'Amsterdam',
    img: '/lander/11/profile-1.png',
  },
  {
    id: 'lisa',
    name: 'Lisa',
    age: 31,
    city: 'Utrecht',
    img: '/lander/11/profile-2.png',
  },
  {
    id: 'emma',
    name: 'Emma',
    age: 42,
    city: 'Rotterdam',
    img: '/lander/11/profile-3.png',
  },
] as const;

const CHAT_PREVIEWS = [
  {
    id: 'chat-1',
    name: 'Sofie',
    preview: 'Hé, ik zag je profiel… wil je even chatten? 😊',
    time: '2 min',
    unread: 2,
    img: '/lander/11/profile-1.png',
  },
  {
    id: 'chat-2',
    name: 'Lisa',
    preview: 'Ben je vanavond nog online?',
    time: '8 min',
    unread: 1,
    img: '/lander/11/profile-2.png',
  },
  {
    id: 'chat-3',
    name: 'Emma',
    preview: 'Ik woon niet ver van je vandaan…',
    time: '14 min',
    unread: 1,
    img: '/lander/11/profile-3.png',
  },
] as const;

const TOTAL_UNREAD = CHAT_PREVIEWS.reduce((n, c) => n + c.unread, 0);

function OnlineDot({ className = '' }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-2.5 w-2.5 ${className}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
    </span>
  );
}

function UnreadBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count < 1) return null;
  return (
    <span
      className={`inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-[#7B2CBF] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ${className}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

function BlurredProfileCard({
  name,
  age,
  city,
  img,
  disabled,
  onUnlock,
}: {
  name: string;
  age: number;
  city: string;
  img: string;
  disabled: boolean;
  onUnlock: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onUnlock}
      className="group relative overflow-hidden rounded-2xl border border-[#7B2CBF]/20 bg-white text-left shadow-sm transition-transform active:scale-[0.98] disabled:opacity-60"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#EDE7F6]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img}
          alt=""
          className="h-full w-full scale-110 object-cover blur-xl brightness-90 saturate-50"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-[#7B2CBF]/20 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 shadow-md ring-2 ring-[#7B2CBF]/30 transition group-hover:scale-105">
            <Lock className="h-4 w-4 text-[#7B2CBF]" aria-hidden />
          </span>
          <span className="text-center text-[10px] font-bold leading-tight text-white drop-shadow sm:text-[11px]">
            Klik om foto te unlocken
          </span>
        </div>
        <span className="absolute right-2 top-2">
          <OnlineDot />
        </span>
      </div>
      <div className="px-2.5 py-2">
        <p className="truncate text-sm font-bold text-gray-900">
          {name}, {age}
        </p>
        <p className="truncate text-xs text-gray-500">{city}</p>
      </div>
    </button>
  );
}

type DiscoveryMode = 'unlock' | 'chat';

export default function Lander11Page() {
  const hiddenOfferRef = useRef<HTMLAnchorElement>(null);
  const [loading, setLoading] = useState(false);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('unlock');
  const [toastVisible, setToastVisible] = useState(false);
  const [chatToastVisible, setChatToastVisible] = useState(false);

  const goToOffer = useCallback(() => {
    hiddenOfferRef.current?.click();
  }, []);

  const startDiscovery = useCallback(
    (mode: DiscoveryMode) => {
      if (loading) return;
      setDiscoveryMode(mode);
      setLoading(true);
      window.setTimeout(() => {
        goToOffer();
      }, mode === 'chat' ? 1400 : 1800);
    },
    [loading, goToOffer]
  );

  const unlockProfile = useCallback(() => startDiscovery('unlock'), [startDiscovery]);
  const openChat = useCallback(() => startDiscovery('chat'), [startDiscovery]);

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
    const t1 = window.setTimeout(() => setToastVisible(true), 2200);
    const t2 = window.setTimeout(() => setChatToastVisible(true), 4800);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  const loadingTitle =
    discoveryMode === 'unlock' ? 'Foto’s ontgrendelen…' : 'Berichten laden…';

  const loadingSub =
    discoveryMode === 'unlock'
      ? 'Profielen in jouw regio worden geladen'
      : `${TOTAL_UNREAD} ongelezen gesprekken wachten op je`;

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
        aria-live="polite"
        className="fixed bottom-24 left-4 right-4 z-40 mx-auto max-w-sm space-y-2 sm:bottom-8 sm:right-6 sm:left-auto"
      >
        <div
          className={`transition-all duration-500 ${
            toastVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
          }`}
        >
          <div className="flex items-center gap-3 rounded-2xl border border-white/90 bg-white px-4 py-3 shadow-[0_12px_40px_-12px_rgba(123,44,191,0.35)]">
            <OnlineDot />
            <p className="text-sm font-medium text-gray-800">Nieuwe vrouw online in jouw regio</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openChat}
          disabled={loading}
          className={`flex w-full items-center gap-3 rounded-2xl border border-white/90 bg-white px-4 py-3 text-left shadow-[0_12px_40px_-12px_rgba(123,44,191,0.35)] transition-all duration-500 disabled:opacity-60 ${
            chatToastVisible
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-3 opacity-0'
          }`}
        >
          <span className="relative shrink-0">
            <MessageCircle className="h-5 w-5 text-[#7B2CBF]" aria-hidden />
            <UnreadBadge count={TOTAL_UNREAD} className="absolute -right-1.5 -top-1.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              {TOTAL_UNREAD} ongelezen berichten
            </p>
            <p className="truncate text-xs text-gray-500">Sofie: Hé, ik zag je profiel…</p>
          </div>
        </button>
      </div>

      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#F4F0FA]/95 px-6 backdrop-blur-sm">
          <Loader2 className="h-12 w-12 animate-spin text-[#7B2CBF]" aria-hidden />
          <p className="mt-6 text-center text-lg font-bold text-gray-900">{loadingTitle}</p>
          <p className="mt-2 text-center text-sm font-medium text-[#7B2CBF]">{loadingSub}</p>
        </div>
      )}

      <div className="mx-auto max-w-lg px-4 pb-10 pt-7 sm:max-w-xl sm:px-6 sm:pt-9">
        <div className="mb-5 flex flex-wrap justify-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#7B2CBF] shadow-sm">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden />
            Populair in jouw regio
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7B2CBF]/10 px-3 py-1.5 text-xs font-semibold text-[#5a1f8f]">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Vandaag 2.483 vrouwen actief
          </span>
        </div>

        <header className="mb-6 text-center">
          <h1 className="text-balance text-2xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-3xl">
            Vrouwen bij jou in de buurt
          </h1>
          <p className="mt-3 text-base font-medium text-gray-600">
            Ontgrendel profielen en bekijk je ongelezen berichten.
          </p>
        </header>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-gray-900">Profielen</h2>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <OnlineDot />
              Nu online
            </span>
          </div>
          <p className="mb-4 text-sm text-gray-600">
            Profielen worden pas getoond na registratie — klik om te unlocken.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BLURRED_PROFILES.map((profile) => (
              <BlurredProfileCard
                key={profile.id}
                name={profile.name}
                age={profile.age}
                city={profile.city}
                img={profile.img}
                disabled={loading}
                onUnlock={unlockProfile}
              />
            ))}
          </div>
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-[#7B2CBF]/15 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 bg-[#FAF8FC] px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-[#7B2CBF]" aria-hidden />
              <h2 className="text-base font-bold text-gray-900">Berichten</h2>
              <UnreadBadge count={TOTAL_UNREAD} />
            </div>
            <span className="text-xs font-medium text-gray-500">Zojuist bijgewerkt</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {CHAT_PREVIEWS.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={openChat}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#F4F0FA] disabled:opacity-60"
                >
                  <span className="relative shrink-0">
                    <span className="block h-12 w-12 overflow-hidden rounded-full bg-[#EDE7F6] ring-2 ring-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={chat.img}
                        alt=""
                        className="h-full w-full scale-110 object-cover blur-md"
                      />
                    </span>
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-900">{chat.name}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">{chat.time}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-gray-600">{chat.preview}</span>
                      <UnreadBadge count={chat.unread} className="shrink-0" />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-gray-100 bg-[#FAF8FC] px-4 py-3 text-center">
            <button
              type="button"
              disabled={loading}
              onClick={openChat}
              className="text-sm font-semibold text-[#7B2CBF] hover:underline disabled:opacity-60"
            >
              Bekijk alle {TOTAL_UNREAD} ongelezen berichten →
            </button>
          </div>
        </section>

        <section className="mt-6 text-center">
          <a
            href={CTA_URL}
            className="group inline-flex w-full items-center justify-center gap-2 rounded-[24px] bg-[#7B2CBF] px-6 py-5 text-lg font-bold text-white shadow-[0_16px_40px_-8px_rgba(123,44,191,0.55)] transition-all hover:bg-[#6a24a8] active:scale-[0.98]"
          >
            Bekijk vrouwen in mijn regio
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
