'use client';

import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Cake, Heart, Briefcase, MapPin, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Profile } from '@/lib/types/profile';
import { profilePhotoSrc, resolveProfileImageUrl } from '@/lib/profile-image-url';
import { isProfileDisplayedOnline } from '@/lib/profile-display-online';
import { getCreditsBalance } from '@/lib/credits-client';
import {
  DEFAULT_PHOTO_REQUEST_DRAFT,
  PROFILE_PHOTO_REQUEST_NAV_KEY,
  type ProfilePhotoRequestNavPayload,
} from '@/lib/profile-photo-request';

type PortfolioItem = {
  conversationId: string;
  messageId: string;
  createdAt: string;
  imageUrl: string;
};

function CreditsCornerPill() {
  const [n, setN] = useState(() => (typeof window !== 'undefined' ? getCreditsBalance() : 0));
  useEffect(() => {
    const sync = () => setN(getCreditsBalance());
    sync();
    window.addEventListener('dm-credits-updated', sync);
    return () => window.removeEventListener('dm-credits-updated', sync);
  }, []);
  return (
    <div className="rounded-full border border-gray-200/90 bg-white/95 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-gray-700 shadow-sm backdrop-blur-sm transition-conv">
      {n} cr
    </div>
  );
}

export default function ProfielDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id ?? '');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  React.useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/profiles/${id}`, { credentials: 'include' });
        if (!res.ok) {
          if (!cancel) setProfile(null);
          return;
        }
        const data = (await res.json()) as { profile?: Profile };
        if (!cancel) setProfile(data.profile ?? null);
      } finally {
        if (!cancel) setProfileLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  React.useEffect(() => {
    if (!profile) return;
    let cancel = false;
    (async () => {
      setPortfolioLoading(true);
      try {
        const res = await fetch(`/api/profiles/${profile.id}/portfolio`, { credentials: 'include' });
        if (res.status === 401) {
          if (!cancel) setPortfolioItems([]);
          return;
        }
        const data = (await res.json()) as { items?: PortfolioItem[] };
        if (!cancel) setPortfolioItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (!cancel) setPortfolioItems([]);
      } finally {
        if (!cancel) setPortfolioLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [profile?.id]);

  if (profileLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-gray-600">Profiel laden…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-gray-600">Profiel niet gevonden.</p>
        <Link href="/profielen" className="font-semibold text-primary">
          Terug naar profielen
        </Link>
      </div>
    );
  }

  const handleProfileLike = () => {
    setLiked((v) => !v);
    if (liked) return;
    void fetch('/api/engagement/like', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profile.id, source: 'profile_like' }),
    }).catch(() => {
      /* best effort */
    });
  };

  const requestPhotoCta = () => {
    try {
      const payload: ProfilePhotoRequestNavPayload = {
        profileId: profile.id,
        draft: DEFAULT_PHOTO_REQUEST_DRAFT,
      };
      sessionStorage.setItem(PROFILE_PHOTO_REQUEST_NAV_KEY, JSON.stringify(payload));
    } catch {
      /* best effort */
    }
    router.push(`/berichten?profile=${encodeURIComponent(profile.id)}`);
  };

  const idSeed = Array.from(profile.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const showOnlineUi = isProfileDisplayedOnline(profile.id);
  const avatarUrl = profilePhotoSrc(profile.photo, { widthCss: 128, heightCss: 160 });
  const tag1 = `${1990 + (idSeed % 10)}-0${1 + (idSeed % 9)}-1`;
  const interestTag = profile.interests[0] ?? 'Creatief';
  const profilePhotos = (() => {
    const raw = [profile.photo, ...(profile.photoGallery ?? [])].filter(Boolean) as string[];
    const unique = [...new Set(raw)];
    return unique.length > 0 ? unique : [avatarUrl];
  })();
  const activePhoto = profilePhotos[Math.min(activePhotoIndex, profilePhotos.length - 1)] ?? avatarUrl;
  /** Profielfoto image-source: rewrite alleen `/api/...` naar absoluut, externe https blijft, static assets blijven. */
  const activePhotoImageUrl = resolveProfileImageUrl(activePhoto);
  const nextPhoto = () =>
    setActivePhotoIndex((prev) => (profilePhotos.length <= 1 ? 0 : (prev + 1) % profilePhotos.length));
  const prevPhoto = () =>
    setActivePhotoIndex((prev) =>
      profilePhotos.length <= 1 ? 0 : (prev - 1 + profilePhotos.length) % profilePhotos.length
    );

  return (
    <div className="flex min-h-[100dvh] min-h-screen flex-col bg-[var(--surface)] pb-10 md:min-h-screen md:pb-10">
      <Navbar />

      <div className="pointer-events-none fixed right-3 top-14 z-[45] md:hidden">
        <div className="pointer-events-auto">
          <CreditsCornerPill />
        </div>
      </div>

      {/* ——— Mobile: Tinder-like stack ——— */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-3 pt-14 md:hidden">
        <div className="mb-3 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition-conv">
          <div className="relative aspect-[3/4] bg-gray-100">
            <img src={activePhotoImageUrl} alt="" className="h-full w-full object-cover object-top" />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 p-2">
              {profilePhotos.map((_, idx) => (
                <span
                  key={`m-dot-${idx}`}
                  className={`h-1.5 flex-1 rounded-full ${
                    idx === activePhotoIndex ? 'bg-white' : 'bg-white/40'
                  }`}
                />
              ))}
            </div>
            {profilePhotos.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={prevPhoto}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-1.5 text-white"
                  aria-label="Vorige foto"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={nextPhoto}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35 p-1.5 text-white"
                  aria-label="Volgende foto"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : null}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-4 text-white">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">
                  {profile.name}, {profile.age}
                </h1>
                {showOnlineUi ? (
                  <span className="online-dot-pulse inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                ) : null}
              </div>
              <p className="mt-1 flex items-center gap-1 text-sm text-white/90">
                <MapPin className="h-3.5 w-3.5" />
                {profile.location}
              </p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-800">
                Vrijgezel
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-800">
                {interestTag}
              </span>
            </div>
            {profile.bio ? <p className="text-sm leading-relaxed text-gray-700">{profile.bio}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-gray-300"
                onClick={handleProfileLike}
              >
                <Heart className={`mr-2 h-4 w-4 ${liked ? 'fill-primary text-primary' : 'text-gray-600'}`} />
                Like
              </Button>
              <Button type="button" onClick={requestPhotoCta} className="h-11 rounded-xl text-sm font-semibold">
                Start chat
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-xs font-semibold text-gray-500"
            >
              {expanded ? 'Minder tonen' : 'Meer info tonen'}
            </button>
            {expanded ? (
              <div className="space-y-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                <p className="flex items-center gap-1.5">
                  <Cake className="h-3.5 w-3.5" /> Geboren: {tag1}
                </p>
                <p className="flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" /> Interesses: {profile.interests.slice(0, 6).join(' · ')}
                </p>
                <Link href="/berichten" className="inline-flex items-center text-xs font-semibold text-primary">
                  Open volledige inbox →
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mb-2 shrink-0 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm transition-conv">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Portfolio</h3>
            <span className="text-[11px] font-medium text-gray-500">Laatste 30 dagen</span>
          </div>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(portfolioItems.length > 0 ? portfolioItems : Array.from({ length: 6 }).map((_, i) => ({
              conversationId: `placeholder-${i}`,
              messageId: `placeholder-${i}`,
              createdAt: new Date().toISOString(),
              imageUrl: avatarUrl,
            }))).map((item) => {
              const imageUrl = resolveProfileImageUrl(item.imageUrl);
              return (
                <div
                  key={`${item.conversationId}:${item.messageId}`}
                  className="relative h-52 w-36 shrink-0 snap-start overflow-hidden rounded-2xl border border-gray-200 bg-gray-100"
                >
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-full w-full object-cover blur-xl scale-110"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-0 bg-black/25" />
                </div>
              );
            })}
          </div>
          {portfolioLoading ? (
            <p className="mt-2 text-[11px] text-gray-500">Portfolio laden…</p>
          ) : null}
        </div>

      </div>

      {/* ——— Desktop: balanced two-column layout ——— */}
      <div className="mx-auto hidden w-full max-w-7xl grid-cols-12 items-start gap-6 px-6 py-8 md:grid lg:px-8">
        {/* Left: large photo (responsive, constrained height) */}
        <div className="space-y-4 md:col-span-5">
          <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="relative aspect-[3/4] max-h-[82vh] bg-gray-100">
              <img src={activePhotoImageUrl} alt="" className="h-full w-full object-cover object-top" decoding="async" />
              <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-1 p-3">
                {profilePhotos.map((_, idx) => (
                  <span
                    key={`d-dot-${idx}`}
                    className={`h-1.5 flex-1 rounded-full ${
                      idx === activePhotoIndex ? 'bg-white' : 'bg-white/40'
                    }`}
                  />
                ))}
              </div>
              {profilePhotos.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={prevPhoto}
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-sm transition hover:bg-black/60"
                    aria-label="Vorige foto"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={nextPhoto}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur-sm transition hover:bg-black/60"
                    aria-label="Volgende foto"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-6 text-white">
                <h1 className="text-4xl font-bold tracking-tight">
                  {profile.name}, {profile.age}
                </h1>
                <p className="mt-1.5 flex items-center gap-2 text-[15px] text-white/90">
                  <MapPin className="h-4 w-4" />
                  {profile.location}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-12 rounded-2xl border-gray-300 text-base transition-conv active:scale-[0.985]"
              onClick={handleProfileLike}
            >
              <Heart className={`mr-2 h-5 w-5 ${liked ? 'fill-primary text-primary' : 'text-primary'}`} />
              Like
            </Button>
            <Button
              type="button"
              onClick={requestPhotoCta}
              className="h-12 rounded-2xl text-base font-semibold shadow-sm"
            >
              Start chat
            </Button>
          </div>
        </div>

        {/* Right: info + portfolio + chat (fills remaining height) */}
        <div className="flex h-full flex-col space-y-6 md:col-span-7">
          {/* Profile info card */}
          <div className="rounded-3xl border border-gray-100 bg-white p-7 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="platform-heading flex items-center gap-2 text-3xl normal-case text-gray-900">
                    {profile.name}, {profile.age}
                    {showOnlineUi ? (
                      <span className="online-dot-pulse ml-1 inline-block h-3 w-3 rounded-full bg-emerald-500" />
                    ) : null}
                  </h1>
                  <p className="text-sm font-medium text-primary-deep">Reageert meestal binnen enkele minuten</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700">
                Meer ▾
              </Button>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-sm text-gray-700">
                <Cake className="h-4 w-4" /> {tag1}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-sm text-gray-700">
                <Heart className="h-4 w-4" /> Vrijgezel
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5 text-sm text-gray-700">
                <Briefcase className="h-4 w-4" /> {interestTag}
              </span>
            </div>

            {profile.bio ? <p className="text-[15px] leading-relaxed text-gray-700">{profile.bio}</p> : null}

            {profile.interests.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {profile.interests.slice(0, 10).map((interest) => (
                  <span
                    key={interest}
                    className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-700"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* Portfolio */}
          <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Portfolio</h2>
              <span className="text-xs font-medium text-gray-500">Intieme foto’s · laatste 30 dagen</span>
            </div>
            <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(portfolioItems.length > 0 ? portfolioItems : Array.from({ length: 6 }).map((_, i) => ({
                conversationId: `placeholder-${i}`,
                messageId: `placeholder-${i}`,
                createdAt: new Date().toISOString(),
                imageUrl: avatarUrl,
              }))).map((item) => {
                const imageUrl = resolveProfileImageUrl(item.imageUrl);
                return (
                  <div
                    key={`${item.conversationId}:${item.messageId}`}
                    className="relative h-80 w-56 shrink-0 snap-start overflow-hidden rounded-2xl border border-gray-200 bg-gray-100"
                  >
                    <img
                      src={imageUrl}
                      alt=""
                      className="h-full w-full object-cover blur-xl scale-110"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-black/25" />
                  </div>
                );
              })}
            </div>
            {portfolioLoading ? <p className="mt-2 text-xs text-gray-500">Portfolio laden…</p> : null}
          </div>

        </div>
      </div>
    </div>
  );
}
