'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type { Profile } from '@/lib/types/profile';
import { profilePhotoSrc } from '@/lib/profile-image-url';
import { isProfileDisplayedOnline } from '@/lib/profile-display-online';
import { ChevronLeft, ChevronRight, Heart, MapPin, Send, Sparkles, X } from 'lucide-react';

const SWIPE_THRESHOLD = 110;

const WISH_SUGGESTIONS = [
  'Gele lingerie op bed',
  'Naakt voor de spiegel',
  'In je douche, doorweekt',
  'String + sokjes op kamer',
  'In je auto, vest open',
  'Stripteasend in keuken',
];

function uniquePhotosForProfile(p: Profile): string[] {
  const raw = [p.photo, ...(p.photoGallery ?? [])].filter(Boolean) as string[];
  return [...new Set(raw)];
}

type WishSheetState =
  | { kind: 'closed' }
  | { kind: 'open'; profile: Profile; text: string; sending: boolean; error: string | null };

export default function SwipePage() {
  const router = useRouter();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [photoIndexByProfile, setPhotoIndexByProfile] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ dx: number; active: boolean; pointerId: number | null }>({
    dx: 0,
    active: false,
    pointerId: null,
  });
  const [flyOff, setFlyOff] = useState<'left' | 'right' | null>(null);
  const [wishSheet, setWishSheet] = useState<WishSheetState>({ kind: 'closed' });
  const [toast, setToast] = useState<string | null>(null);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/profiles', {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await res.json()) as { profiles?: Profile[]; error?: string };
        if (cancel) return;
        if (!res.ok) {
          setLoadError(data.error || 'Profielen laden mislukt.');
          setProfiles([]);
        } else {
          const list = Array.isArray(data.profiles) ? data.profiles : [];
          const shuffled = list
            .map((p) => ({ p, k: Math.random() }))
            .sort((a, b) => a.k - b.k)
            .map((x) => x.p);
          setProfiles(shuffled);
        }
      } catch {
        if (!cancel) {
          setLoadError('Netwerkfout bij laden van profielen.');
          setProfiles([]);
        }
      } finally {
        if (!cancel) setLoaded(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const current = profiles[index];
  const upcoming = profiles[index + 1];

  const currentPhotos = useMemo(
    () => (current ? uniquePhotosForProfile(current) : []),
    [current]
  );
  const currentPhotoIndex = current ? photoIndexByProfile[current.id] ?? 0 : 0;
  const currentPhotoUrl =
    currentPhotos[Math.min(currentPhotoIndex, Math.max(0, currentPhotos.length - 1))] ??
    current?.photo ??
    '';

  const upcomingPhotos = useMemo(
    () => (upcoming ? uniquePhotosForProfile(upcoming) : []),
    [upcoming]
  );

  const advance = useCallback(() => {
    setFlyOff(null);
    setDrag({ dx: 0, active: false, pointerId: null });
    dragStartRef.current = null;
    setIndex((i) => i + 1);
  }, []);

  const openWishSheetFor = useCallback((profile: Profile) => {
    setWishSheet({
      kind: 'open',
      profile,
      text: '',
      sending: false,
      error: null,
    });
  }, []);

  const triggerSwipe = useCallback(
    (direction: 'left' | 'right') => {
      if (!current || flyOff) return;
      setFlyOff(direction);
      if (direction === 'right') {
        const profile = current;
        // Wacht de fly-off animatie even af zodat de UI rustig overgaat naar het wensen-sheet.
        window.setTimeout(() => {
          openWishSheetFor(profile);
        }, 200);
      } else {
        window.setTimeout(advance, 220);
      }
    },
    [advance, current, flyOff, openWishSheetFor]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (flyOff || !current || wishSheet.kind === 'open') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, active: true, pointerId: e.pointerId });
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.active || drag.pointerId !== e.pointerId || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    setDrag((d) => ({ ...d, dx }));
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const dx = drag.dx;
    setDrag({ dx: 0, active: false, pointerId: null });
    dragStartRef.current = null;
    if (dx > SWIPE_THRESHOLD) {
      triggerSwipe('right');
    } else if (dx < -SWIPE_THRESHOLD) {
      triggerSwipe('left');
    }
  };

  const setPhotoIndex = (profileId: string, next: number) => {
    setPhotoIndexByProfile((m) => ({ ...m, [profileId]: next }));
  };
  const showPrevPhoto = () => {
    if (!current || currentPhotos.length <= 1) return;
    const next = (currentPhotoIndex - 1 + currentPhotos.length) % currentPhotos.length;
    setPhotoIndex(current.id, next);
  };
  const showNextPhoto = () => {
    if (!current || currentPhotos.length <= 1) return;
    const next = (currentPhotoIndex + 1) % currentPhotos.length;
    setPhotoIndex(current.id, next);
  };

  const swipeStyle: React.CSSProperties = (() => {
    if (flyOff) {
      const off = flyOff === 'right' ? 700 : -700;
      const rot = flyOff === 'right' ? 22 : -22;
      return {
        transform: `translate3d(${off}px, 0, 0) rotate(${rot}deg)`,
        transition: 'transform 220ms ease-out',
        opacity: 0,
      };
    }
    if (drag.active) {
      const rotate = Math.max(-18, Math.min(18, drag.dx / 14));
      return {
        transform: `translate3d(${drag.dx}px, 0, 0) rotate(${rotate}deg)`,
        transition: 'transform 0ms',
      };
    }
    return {
      transform: 'translate3d(0,0,0) rotate(0deg)',
      transition: 'transform 200ms ease-out',
    };
  })();

  const directionOverlay = (() => {
    if (flyOff === 'right' || (drag.active && drag.dx > 40))
      return { side: 'right' as const, intensity: Math.min(1, Math.abs(drag.dx) / 160) };
    if (flyOff === 'left' || (drag.active && drag.dx < -40))
      return { side: 'left' as const, intensity: Math.min(1, Math.abs(drag.dx) / 160) };
    return null;
  })();

  const exhausted = loaded && profiles.length > 0 && index >= profiles.length;

  const sendWish = useCallback(async () => {
    if (wishSheet.kind !== 'open') return;
    const text = wishSheet.text.trim();
    if (!text || wishSheet.sending) return;
    setWishSheet({ ...wishSheet, sending: true, error: null });
    try {
      const convRes = await fetch('/api/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: wishSheet.profile.id }),
      });
      const convData = (await convRes.json()) as {
        conversation?: { id: string };
        error?: string;
      };
      if (!convRes.ok || !convData.conversation?.id) {
        throw new Error(convData.error || 'Kon de chat niet starten.');
      }
      const conversationId = convData.conversation.id;
      const msgRes = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        }
      );
      const msgData = (await msgRes.json()) as { error?: string };
      if (!msgRes.ok) {
        throw new Error(msgData.error || 'Bericht niet verzonden.');
      }
      setWishSheet({ kind: 'closed' });
      setToast(`Wensen verstuurd naar ${wishSheet.profile.name}`);
      advance();
    } catch (e) {
      setWishSheet({
        ...wishSheet,
        sending: false,
        error: e instanceof Error ? e.message : 'Versturen mislukt.',
      });
    }
  }, [advance, wishSheet]);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-black text-white">
      {/* Top bar — alleen logo gecentreerd, geen menu */}
      <header className="relative z-30 flex items-center justify-center bg-black/70 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.push('/profielen')}
          className="rounded-full px-3 py-1 transition hover:bg-white/5"
          aria-label="Naar profielen"
        >
          <span className="platform-brand text-base md:text-lg">Ontmoetjongens</span>
        </button>
      </header>

      {/* Card area: full-screen onder de top bar */}
      <main className="relative flex-1 select-none">
        {!loaded ? (
          <div className="grid h-full place-items-center text-sm text-white/70">Laden…</div>
        ) : loadError ? (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-red-200">
            {loadError}
          </div>
        ) : profiles.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-white/70">
            Nog geen profielen beschikbaar.
          </div>
        ) : exhausted ? (
          <div className="grid h-full place-items-center px-8 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-lg font-semibold">Je hebt alle profielen gezien</p>
              <p className="text-sm text-white/70">
                Open de inbox om door te chatten met de meiden waar je een wens naar stuurde.
              </p>
              <button
                onClick={() => router.push('/berichten')}
                className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-primary-hover"
              >
                Naar inbox
              </button>
            </div>
          </div>
        ) : (
          <>
            {upcoming ? (
              <div className="absolute inset-0 overflow-hidden">
                <img
                  src={profilePhotoSrc(upcomingPhotos[0] ?? upcoming.photo, {
                    widthCss: 760,
                    heightCss: 1280,
                  })}
                  alt=""
                  className="h-full w-full scale-[1.02] object-cover opacity-70"
                  draggable={false}
                />
                <div className="absolute inset-0 bg-black/30" />
              </div>
            ) : null}

            {current ? (
              <div
                className="absolute inset-0 overflow-hidden bg-black"
                style={{ ...swipeStyle, touchAction: 'none' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                <img
                  src={profilePhotoSrc(currentPhotoUrl, { widthCss: 760, heightCss: 1280 })}
                  alt={current.name}
                  className="h-full w-full object-cover object-top"
                  draggable={false}
                />

                {/* Photo navigation (alleen als profile meerdere fotos heeft) */}
                {currentPhotos.length > 1 ? (
                  <>
                    <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex gap-1">
                      {currentPhotos.map((_, idx) => (
                        <span
                          key={idx}
                          className={`h-1.5 flex-1 rounded-full ${
                            idx === currentPhotoIndex ? 'bg-white' : 'bg-white/30'
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        showPrevPhoto();
                      }}
                      aria-label="Vorige foto"
                      className="absolute left-2 top-12 z-20 rounded-full bg-black/40 p-1.5 text-white/90 backdrop-blur-sm hover:bg-black/55"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        showNextPhoto();
                      }}
                      aria-label="Volgende foto"
                      className="absolute right-2 top-12 z-20 rounded-full bg-black/40 p-1.5 text-white/90 backdrop-blur-sm hover:bg-black/55"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                ) : null}

                {/* Swipe label overlay */}
                {directionOverlay ? (
                  <div
                    className={`pointer-events-none absolute top-20 z-30 ${
                      directionOverlay.side === 'right' ? 'left-6 -rotate-12' : 'right-6 rotate-12'
                    }`}
                    style={{ opacity: directionOverlay.intensity }}
                  >
                    <span
                      className={`rounded-2xl border-4 px-5 py-2 text-2xl font-extrabold uppercase tracking-wider ${
                        directionOverlay.side === 'right'
                          ? 'border-emerald-400 text-emerald-400'
                          : 'border-red-400 text-red-400'
                      }`}
                    >
                      {directionOverlay.side === 'right' ? 'Goed' : 'Skip'}
                    </span>
                  </div>
                ) : null}

                {/* Profielinfo onderaan: alleen naam, leeftijd, stad, hobby's */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black via-black/75 to-transparent px-5 pb-36 pt-16">
                  <div className="flex items-center gap-2">
                    <h2 className="text-3xl font-extrabold leading-tight">
                      {current.name}, {current.age}
                    </h2>
                    {isProfileDisplayedOnline(current.id) ? (
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    ) : null}
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-sm text-white/90">
                    <MapPin className="h-3.5 w-3.5" />
                    {current.location}
                  </p>
                  {current.interests?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {current.interests.slice(0, 6).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* Action buttons (Skip + Goed) zwevend onderaan */}
        {loaded && !loadError && profiles.length > 0 && !exhausted && wishSheet.kind !== 'open' ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-center pb-[max(20px,env(safe-area-inset-bottom))] pt-6"
          >
            <div className="pointer-events-auto flex items-center gap-6">
              <button
                type="button"
                onClick={() => triggerSwipe('left')}
                disabled={!current || !!flyOff}
                aria-label="Skip"
                className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/70 bg-white text-red-500 shadow-xl transition hover:scale-105 disabled:opacity-50"
              >
                <X className="h-7 w-7" strokeWidth={3} />
              </button>
              <button
                type="button"
                onClick={() => triggerSwipe('right')}
                disabled={!current || !!flyOff}
                aria-label="Goed"
                className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-300 bg-white text-emerald-500 shadow-2xl transition hover:scale-105 disabled:opacity-50"
              >
                <Heart className="h-9 w-9 fill-current" />
              </button>
            </div>
          </div>
        ) : null}
      </main>

      {/* Wensen-sheet (na rechts-swipe) */}
      {wishSheet.kind === 'open' ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
          <button
            type="button"
            aria-label="Sluiten"
            onClick={() => {
              if (wishSheet.sending) return;
              setWishSheet({ kind: 'closed' });
              advance();
            }}
            className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
          />
          <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-5 text-gray-900 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-200 sm:hidden" />
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-primary">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                  Foto wensen
                </p>
                <h3 className="truncate text-lg font-bold">
                  Stuur je wens naar {wishSheet.profile.name}
                </h3>
              </div>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              Vertel haar precies wat je geil zou vinden — ze maakt graag persoonlijke foto&apos;s
              voor je. Of typ alvast een leuke opener.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {WISH_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={wishSheet.sending}
                  onClick={() =>
                    setWishSheet((curr) =>
                      curr.kind === 'open'
                        ? {
                            ...curr,
                            text:
                              curr.text.trim().length === 0
                                ? s
                                : `${curr.text.trim()} ${s.toLowerCase()}`,
                          }
                        : curr
                    )
                  }
                  className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>

            <textarea
              value={wishSheet.text}
              onChange={(e) =>
                setWishSheet((curr) =>
                  curr.kind === 'open' ? { ...curr, text: e.target.value, error: null } : curr
                )
              }
              disabled={wishSheet.sending}
              placeholder="Bijv: hey schat, doe je een foto voor me met gele lingerie op bed?"
              rows={3}
              className="mt-3 w-full resize-none rounded-2xl border border-gray-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-primary focus:ring-2 focus:ring-red-100 disabled:opacity-60"
            />

            {wishSheet.error ? (
              <p className="mt-2 text-sm text-red-600">{wishSheet.error}</p>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={wishSheet.sending}
                onClick={() => {
                  setWishSheet({ kind: 'closed' });
                  advance();
                }}
                className="rounded-2xl px-3 py-2 text-sm font-semibold text-gray-500 transition hover:text-gray-700 disabled:opacity-50"
              >
                Sla over
              </button>
              <button
                type="button"
                onClick={() => void sendWish()}
                disabled={wishSheet.sending || wishSheet.text.trim().length === 0}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {wishSheet.sending ? 'Versturen…' : 'Versturen'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Lichte toast na verzenden */}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-[68px] z-50 flex justify-center px-4">
          <div className="rounded-full bg-emerald-600/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
}
