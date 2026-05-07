'use client';

import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Cake, Heart, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Profile } from '@/lib/types/profile';
import { profilePhotoSrc } from '@/lib/profile-image-url';
import { isProfileDisplayedOnline } from '@/lib/profile-display-online';
import { ProfileInlineChat } from '@/components/ProfileInlineChat';
import { getCreditsBalance } from '@/lib/credits-client';

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
  const params = useParams();
  const id = String(params.id ?? '');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const loginRedirect = `/inloggen?next=${encodeURIComponent(`/profielen/${id}`)}`;

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
      setConvLoading(true);
      setConvError(null);
      try {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: profile.id }),
        });
        const data = (await res.json()) as { conversation?: { id: string }; error?: string };
        if (res.status === 401) {
          window.location.assign(loginRedirect);
          return;
        }
        if (!res.ok) throw new Error(data.error ?? 'Chat openen mislukt');
        if (!cancel) {
          setConversationId(String(data.conversation?.id ?? ''));
          setConvError(null);
        }
      } catch (e) {
        if (!cancel) {
          setConversationId(null);
          setConvError(e instanceof Error ? e.message : 'Chat openen mislukt');
        }
      } finally {
        if (!cancel) setConvLoading(false);
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

  const idSeed = Array.from(profile.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const showOnlineUi = isProfileDisplayedOnline(profile.id);
  const avatarUrl = profilePhotoSrc(profile.photo, { widthCss: 128, heightCss: 160 });
  const tag1 = `${1990 + (idSeed % 10)}-0${1 + (idSeed % 9)}-1`;
  const interestTag = profile.interests[0] ?? 'Creatief';

  const chatBlock = (
    <>
      {convError ? (
        <div className="px-4 py-8 text-center text-sm text-red-700">{convError}</div>
      ) : convLoading && !conversationId ? (
        <div className="flex flex-1 items-center justify-center py-12 text-sm text-gray-500">
          Chat wordt geopend…
        </div>
      ) : (
        <ProfileInlineChat
          conversationId={conversationId}
          profileName={profile.name}
          profileAvatar={avatarUrl}
        />
      )}
    </>
  );

  return (
    <div className="flex min-h-[100dvh] min-h-screen flex-col bg-[var(--surface)] pb-28 md:min-h-screen md:pb-10">
      <Navbar />

      <div className="pointer-events-none fixed right-3 top-14 z-[45] md:hidden">
        <div className="pointer-events-auto">
          <CreditsCornerPill />
        </div>
      </div>

      {/* ——— Mobile: verticale stack, chat vult resterende hoogte ——— */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-3 pt-14 md:hidden">
        <div className="mb-2 shrink-0 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm transition-conv">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full min-h-[44px] items-center gap-3 text-left transition-conv active:opacity-90"
          >
            <img
              src={avatarUrl}
              alt=""
              width={60}
              height={60}
              className="h-[60px] w-[60px] shrink-0 rounded-2xl object-cover object-top ring-2 ring-gray-200/80"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold text-gray-900">
                  {profile.name}, {profile.age}
                </span>
                {showOnlineUi ? (
                  <span
                    className="online-dot-pulse inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-white"
                    aria-label="Online"
                  />
                ) : null}
              </div>
              {showOnlineUi ? (
                <p className="text-sm font-medium text-emerald-800">
                  Reageert meestal binnen enkele minuten
                </p>
              ) : (
                <p className="text-sm text-gray-500">Laatst actief onlangs</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-800">
                  Vrijgezel
                </span>
                <span className="max-w-[160px] truncate rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-800">
                  {interestTag}
                </span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
                  {tag1}
                </span>
              </div>
            </div>
            <span className="shrink-0 text-gray-400">{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded ? (
            <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 text-[15px] leading-relaxed text-gray-800 transition-conv">
              {profile.bio ? <p>{profile.bio}</p> : null}
              {profile.interests.length > 1 ? (
                <p className="text-sm text-gray-600">
                  Interesses: {profile.interests.slice(0, 6).join(' · ')}
                </p>
              ) : null}
              {conversationId ? (
                <Link
                  href={`/berichten?chat=${conversationId}`}
                  className="inline-flex min-h-[44px] items-center text-base font-semibold text-gray-900 underline decoration-primary decoration-2 underline-offset-4"
                >
                  Open volledige inbox →
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 rounded-2xl border border-gray-100 bg-gray-50/90 p-3">
            <Button
              type="button"
              variant="outline"
              className="h-12 min-h-[48px] w-full rounded-2xl border-2 border-gray-300 bg-white text-base font-semibold text-gray-900 transition-conv hover:bg-gray-50"
              onClick={handleProfileLike}
            >
              <Heart
                className={`mr-2 h-5 w-5 ${liked ? 'fill-primary text-primary' : 'text-gray-600'}`}
              />
              Like
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-conv">
          <div className="shrink-0 border-b border-gray-100 px-3 py-2.5">
            <span className="text-sm font-bold text-gray-900">Chat</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{chatBlock}</div>
        </div>
      </div>

      {/* ——— Desktop: bestaand grid ——— */}
      <div className="mx-auto hidden max-w-6xl grid-cols-12 gap-6 px-4 py-6 md:grid lg:px-6">
        <div className="space-y-4 lg:col-span-5">
          <div className="mx-auto w-full max-w-[112px] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md ring-1 ring-black/5 sm:max-w-[128px] lg:mx-0">
            <img
              src={avatarUrl}
              alt=""
              width={128}
              height={160}
              className="aspect-[4/5] h-auto w-full object-cover object-top"
              decoding="async"
            />
          </div>
          <div className="max-w-xs">
            <Button
              variant="outline"
              className="flex w-full flex-col gap-1 rounded-2xl py-6 transition-conv"
              onClick={handleProfileLike}
            >
              <Heart className={`h-6 w-6 ${liked ? 'fill-primary text-primary' : 'text-primary'}`} />
              <span className="text-xs">Like</span>
            </Button>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-7">
          <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
                  i
                </span>
                <div>
                  <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                    {profile.name}, {profile.age}
                    {showOnlineUi ? (
                      <span className="online-dot-pulse inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    ) : null}
                  </h1>
                  <p className="text-xs font-medium text-emerald-700">
                    Reageert meestal binnen enkele minuten
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-gray-500">
                Meer ▾
              </Button>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
                <Cake className="h-4 w-4" />
                {tag1}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
                <Heart className="h-4 w-4" />
                Vrijgezel
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
                <Briefcase className="h-4 w-4" />
                {interestTag}
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center border-b border-gray-100 px-4 py-3">
              <span className="font-semibold">Chat</span>
            </div>
            {chatBlock}
          </div>
        </div>
      </div>
    </div>
  );
}
