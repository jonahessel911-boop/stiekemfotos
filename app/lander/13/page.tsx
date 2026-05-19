'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, MessageCircle, X } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import { NL_MAP_VIEWBOX, PROVINCE_PATHS } from '../9/province-paths';
import './lander-13.css';

const CTA_URL = 'https://911-for-me.com/cf/click';

const PROFILES = [
  { id: 'sofie', name: 'Sofie', img: '/lander/13/profile-1.png' },
  { id: 'lisa', name: 'Lisa', img: '/lander/13/profile-2.png' },
  { id: 'emma', name: 'Emma', img: '/lander/13/profile-3.png' },
] as const;

const POPUP_POSITIONS = [
  { left: '12%', top: '24%' },
  { left: '56%', top: '18%' },
  { left: '30%', top: '50%' },
  { left: '18%', top: '42%' },
  { left: '48%', top: '38%' },
] as const;

const ROTATE_MS = 3200;

function OnlineDot() {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ff5eb8] opacity-70" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#ff2d95] ring-2 ring-white" />
    </span>
  );
}

function ChatPopup({
  name,
  img,
  left,
  top,
  swapKey,
  onChat,
  onDismiss,
}: {
  name: string;
  img: string;
  left: string;
  top: string;
  swapKey: number;
  onChat: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="chat-popup signup-popup-pulse pointer-events-auto absolute z-20 max-w-[190px] transition-[left,top] duration-500 ease-out"
      style={{ left, top }}
    >
      <button
        type="button"
        onClick={onChat}
        className="chat-popup-swap flex w-full items-center gap-2.5 rounded-2xl border-2 border-[#ff2d95]/50 bg-white py-2.5 pl-2.5 pr-3 text-left shadow-lg transition active:scale-[0.98]"
        key={swapKey}
      >
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-2 ring-[#ff2d95]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="" className="h-full w-full object-cover" />
          <span className="absolute -bottom-0.5 -right-0.5">
            <OnlineDot />
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#1a0010]">{name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-[#e6007a]">
            <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Wilt nu chatten
          </p>
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#1f0012] text-white shadow-md ring-2 ring-[#ff2d95]"
        aria-label="Sluiten"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function Lander13Page() {
  const hiddenOfferRef = useRef<HTMLAnchorElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [profileIndex, setProfileIndex] = useState(0);
  const [positionIndex, setPositionIndex] = useState(0);
  const [popupVisible, setPopupVisible] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);

  const selectedName = PROVINCE_PATHS.find((p) => p.id === selectedId)?.name;
  const activeProfile = PROFILES[profileIndex];
  const activePosition = POPUP_POSITIONS[positionIndex];

  const goToOffer = useCallback(() => {
    hiddenOfferRef.current?.click();
  }, []);

  const startChat = useCallback(() => {
    if (loading) return;
    setLoading(true);
    window.setTimeout(() => goToOffer(), 1200);
  }, [loading, goToOffer]);

  const selectProvince = useCallback(
    (id: string) => {
      if (loading) return;
      setSelectedId(id);
      setLoading(true);
      window.setTimeout(() => goToOffer(), 1600);
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
    const t = window.setTimeout(() => setPopupVisible(true), 700);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!popupVisible || popupDismissed || loading) return;
    const interval = window.setInterval(() => {
      setProfileIndex((i) => (i + 1) % PROFILES.length);
      setPositionIndex((i) => (i + 1) % POPUP_POSITIONS.length);
    }, ROTATE_MS);
    return () => window.clearInterval(interval);
  }, [popupVisible, popupDismissed, loading]);

  return (
    <div className="lander-13 fixed inset-0 overflow-hidden bg-gradient-to-b from-[#1f0012] via-[#3d0022] to-[#5c0033]">
      <ClickFlareCapture />

      <a ref={hiddenOfferRef} href={CTA_URL} className="sr-only" tabIndex={-1} aria-hidden>
        Offer
      </a>

      {loading && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#1f0012]/90 px-6 backdrop-blur-md">
          <Loader2 className="h-12 w-12 animate-spin text-[#ff2d95]" aria-hidden />
          <p className="mt-6 text-center text-lg font-bold text-white">
            {selectedName ? 'Vrouwen zoeken in jouw provincie…' : 'Chat wordt gestart…'}
          </p>
          {selectedName && (
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-[#ff85c0]">
              <MapPin className="h-4 w-4" aria-hidden />
              {selectedName}
            </p>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-[#1f0012] via-[#1f0012]/80 to-transparent px-4 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))] text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff5eb8]">
          Live in Nederland
        </p>
        <h1 className="mt-1 text-balance text-lg font-extrabold leading-tight text-white drop-shadow-sm sm:text-xl">
          Selecteer waar je vrouwen wilt ontmoeten
        </h1>
        <p className="mt-1 text-xs font-medium text-[#ffb3dc] sm:text-sm">
          Tik op een provincie op de kaart
        </p>
      </div>

      <div className="absolute inset-0 flex items-center justify-center px-1 pt-16 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <svg
          viewBox={NL_MAP_VIEWBOX}
          className="h-full w-full max-h-full max-w-[min(100%,480px)] touch-manipulation"
          role="img"
          aria-label="Kaart van Nederland — klik op een provincie"
        >
          <defs>
            <filter id="glow13" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {PROVINCE_PATHS.map((p) => {
            const active = selectedId === p.id || hoveredId === p.id;
            const fillClass = active
              ? 'fill-[#ff2d95] stroke-[#ffb3dc]'
              : 'fill-[#ff5eb8]/75 stroke-[#ff85c0] hover:fill-[#ff2d95]/90';

            return (
              <g
                key={p.id}
                className="cursor-pointer transition-all duration-300"
                style={active ? { filter: 'url(#glow13)' } : undefined}
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
                    strokeWidth={active ? 1 : 0.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </g>
            );
          })}
        </svg>

        {popupVisible && !popupDismissed && !loading && (
          <ChatPopup
            name={activeProfile.name}
            img={activeProfile.img}
            left={activePosition.left}
            top={activePosition.top}
            swapKey={profileIndex}
            onChat={startChat}
            onDismiss={() => setPopupDismissed(true)}
          />
        )}
      </div>

      <p className="pointer-events-none absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-0 right-0 z-10 text-center text-[10px] font-medium text-[#ff85c0]/80">
        18+
      </p>
    </div>
  );
}
