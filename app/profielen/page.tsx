'use client';

import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import type { Profile } from '@/lib/types/profile';
import { Heart, Users, Camera, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { profilePhotoSrc } from '@/lib/profile-image-url';
import { isProfileDisplayedOnline } from '@/lib/profile-display-online';

/** Unieke foto-URL’s (avatar + galerij), volgorde behouden. */
function profilePhotoCandidates(profile: Profile): string[] {
  const raw = [profile.photo, ...(profile.photoGallery ?? [])].filter(Boolean) as string[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of raw) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out.length ? out : [profile.photo];
}

/**
 * Willekeurige kaartfoto uit avatar + galerij; keuze wordt per sessie/profiel gecached
 * zodat tabs/filter niet bij elke render een andere foto tonen.
 */
function pickRandomCardPreviewPhoto(profile: Profile, cache: Map<string, string>): string {
  const urls = profilePhotoCandidates(profile);
  if (urls.length <= 1) return urls[0] ?? profile.photo;
  const prev = cache.get(profile.id);
  if (prev && urls.includes(prev)) return prev;
  const picked = urls[Math.floor(Math.random() * urls.length)]!;
  cache.set(profile.id, picked);
  return picked;
}

type ProfilesApiMeta = {
  configured?: boolean;
  count?: number;
  vercelEnv?: string;
  serviceRole?: boolean;
  hint?: 'supabase_env_missing' | 'empty_database' | 'empty_uncertain';
};

export default function ProfielenPage() {
  const cardPreviewPickRef = React.useRef<Map<string, string>>(new Map());
  const [activeTab, setActiveTab] = useState<'all' | 'online' | 'following'>('all');
  const [likedProfiles, setLikedProfiles] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [profilesMeta, setProfilesMeta] = useState<ProfilesApiMeta | null>(null);
  const [profilesFetchError, setProfilesFetchError] = useState<string | null>(null);
  React.useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/profiles', {
          credentials: 'include',
          cache: 'no-store',
        });
        const data = (await res.json()) as {
          profiles?: Profile[];
          meta?: ProfilesApiMeta;
          error?: string;
        };
        if (!cancel) {
          setProfilesFetchError(!res.ok && data.error ? data.error : null);
          setProfilesMeta(data.meta ?? null);
          setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
        }
      } catch {
        if (!cancel) {
          setProfiles([]);
          setProfilesMeta(null);
          setProfilesFetchError('Netwerkfout bij laden van profielen.');
        }
      } finally {
        if (!cancel) setLoaded(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);
  const redirectToLogin = () => {
    window.location.assign('/login?next=%2Fprofielen');
  };

  const filteredProfiles = profiles.filter((profile) => {
    if (activeTab === 'online') return isProfileDisplayedOnline(profile.id);
    return true;
  });

  const toggleLike = (id: string) => {
    if (likedProfiles.includes(id)) {
      setLikedProfiles(likedProfiles.filter(p => p !== id));
    } else {
      setLikedProfiles([...likedProfiles, id]);
      void fetch('/api/engagement/like', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id, source: 'profile_like' }),
      }).catch(() => {
        /* best effort */
      });
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-28 md:pb-10">
      <Navbar />

      <div className="pt-12 sm:pt-14 md:pt-20 max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
        {/* Header with Tabs - exact BestDates style */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="platform-heading text-2xl sm:text-3xl">Profielen</h1>
            <p className="text-sm text-gray-500 mt-0.5">Ontdek nieuwe connecties</p>
          </div>
          
          <Button variant="outline" size="sm" className="flex items-center gap-2 shrink-0">
            <Users className="w-4 h-4" />
            Filters
          </Button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          <button 
            onClick={() => setActiveTab('all')}
            className={`px-5 py-2.5 text-sm font-medium transition-all border-b-2 sm:px-8 sm:py-3 sm:text-base ${activeTab === 'all' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Alle
          </button>
          <button 
            onClick={() => setActiveTab('online')}
            className={`px-5 py-2.5 text-sm font-medium transition-all border-b-2 sm:px-8 sm:py-3 sm:text-base ${activeTab === 'online' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Online
          </button>
          <button 
            onClick={() => setActiveTab('following')}
            className={`px-5 py-2.5 text-sm font-medium transition-all border-b-2 sm:px-8 sm:py-3 sm:text-base ${activeTab === 'following' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Volgend
          </button>
        </div>

        {/* Minder kolommen = grotere foto’s op de kaart */}
        <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {!loaded ? (
            <div className="col-span-full rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500">
              Profielen laden…
            </div>
          ) : profilesFetchError ? (
            <div className="col-span-full rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-900">
              <p className="font-semibold">Profielen konden niet worden geladen.</p>
              <p className="mt-2 text-sm text-red-800">{profilesFetchError}</p>
            </div>
          ) : profilesMeta?.configured === false ? (
            <div className="col-span-full space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-left text-amber-950">
              <p className="font-semibold">Database niet gekoppeld op deze deployment</p>
              <p className="text-sm leading-relaxed">
                Supabase-omgevingsvariabelen ontbreken voor dit Vercel-deployment
                {profilesMeta.vercelEnv ? (
                  <>
                    {' '}
                    (<span className="font-mono">{profilesMeta.vercelEnv}</span>)
                  </>
                ) : null}
                . Voeg in Vercel onder <strong>Settings → Environment Variables</strong> dezelfde
                waarden toe als lokaal (minimaal <span className="font-mono">SUPABASE_URL</span> en{' '}
                <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span>, of de anon key + RLS)
                — ook voor <strong>Preview</strong> als je custom domein aan een preview-branch koppelt.
              </p>
            </div>
          ) : filteredProfiles.length === 0 && profilesMeta?.hint === 'empty_uncertain' ? (
            <div className="col-span-full space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-left text-amber-950">
              <p className="font-semibold">Geen profielen opgehaald</p>
              <p className="text-sm leading-relaxed">
                Dit kan een lege database zijn, of je gebruikt alleen de anon-key en blokkeert RLS lezen.
                Zet op Vercel <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> (zelfde project
                als dev) of voer <span className="font-mono">supabase/grant-profiles-read-to-anon.sql</span>{' '}
                uit. Controleer ook of dit domein aan de <strong>Production</strong>-deployment hangt met
                dezelfde env-vars als <span className="font-mono">*.vercel.app</span>.
              </p>
            </div>
          ) : filteredProfiles.length === 0 && profilesMeta?.hint === 'empty_database' ? (
            <div className="col-span-full rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-600">
              <p>Er staan nog geen actieve profielen in de gekoppelde database.</p>
              <p className="mt-2 text-sm text-gray-500">
                Seed je Supabase-project (bijv. <span className="font-mono">seed-50-test-profiles.sql</span>)
                of kopieer profielen van je dev-project.
              </p>
            </div>
          ) : filteredProfiles.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-600">
              Nog geen profielen beschikbaar.
            </div>
          ) : (
            filteredProfiles.map((profile) => (
            (() => {
              const previewUrl = pickRandomCardPreviewPhoto(profile, cardPreviewPickRef.current);
              return (
            <div 
              key={profile.id}
              className="group flex flex-col bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer"
            >
              <div className="relative aspect-[4/5] w-full overflow-hidden">
                <img
                  src={profilePhotoSrc(previewUrl, { widthCss: 440, heightCss: 550 })}
                  alt={profile.name}
                  width={440}
                  height={550}
                  className="h-full w-full object-cover object-top"
                  loading="lazy"
                  decoding="async"
                />
                
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleLike(profile.id); }}
                  className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-xl bg-white shadow-md transition-all hover:scale-105 z-10 sm:h-8 sm:w-8 sm:rounded-2xl"
                >
                  <Heart 
                    className={`h-3.5 w-3.5 transition-all sm:h-4 sm:w-4 ${likedProfiles.includes(profile.id) 
                      ? 'fill-[#ff3b5c] text-[#ff3b5c]' 
                      : 'text-gray-400 group-hover:text-gray-600'}`} 
                  />
                </button>

                {isProfileDisplayedOnline(profile.id) ? (
                  <div
                    className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 shadow-md ring-1 ring-emerald-500/40"
                    title="Online"
                  >
                    <span className="online-dot-pulse h-3 w-3 rounded-full bg-emerald-500" />
                  </div>
                ) : null}
                
                <div className="absolute bottom-2 left-2 right-2 flex justify-end items-end pointer-events-none">
                  <div className="flex gap-1 pointer-events-auto">
                    <span className="bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-0.5 font-medium sm:text-xs sm:px-2 sm:py-1 sm:rounded-lg">
                      <Camera className="h-3 w-3 sm:w-3.5 sm:h-3.5" />
                      {profile.photosCount}
                    </span>
                    {profile.videoCount != null && profile.videoCount > 0 ? (
                      <span className="bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-0.5 font-medium sm:text-xs sm:px-2 sm:py-1 sm:rounded-lg">
                        <Video className="h-3 w-3 sm:w-3.5 sm:h-3.5" />
                        {profile.videoCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              
              <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3 sm:px-3.5 sm:pt-3 sm:pb-3.5">
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1 leading-tight">
                  <span className="font-bold text-[15px] text-gray-900 sm:text-base">{profile.name}</span>
                  <span className="text-gray-400 text-sm">,</span>
                  <span className="font-semibold text-[15px] text-gray-900 sm:text-base">{profile.age}</span>
                </div>
                
                <div className="mt-auto">
                  <Link
                    href={`/profielen/${profile.id}`}
                    className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-gray-900 py-2.5 text-center text-xs font-bold text-white shadow-sm transition-colors hover:bg-gray-800 sm:min-h-[48px] sm:rounded-2xl sm:text-sm"
                  >
                    Bekijk profiel
                  </Link>
                </div>
              </div>
            </div>
              );
            })()
            ))
          )}
        </div>
      </div>
    </div>
  );
}
