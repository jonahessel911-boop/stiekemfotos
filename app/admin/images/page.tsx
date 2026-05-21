'use client';

import React, { useEffect, useState } from 'react';
import { useAdmin } from '@/components/admin/AdminProvider';

/** West-EU tekstprofielen in één API-call (geen images). */
const TEXT_PROFILE_BATCH_COUNT = 10;

/** Aantal profielen bij oude “batch random met AI-foto's”. */
const RANDOM_PROFILE_BATCH_COUNT = 50;

type TextProfileItem = {
  profileId: string;
  slug: string;
  name: string;
  age: number;
  city: string;
  heritage: string;
  bio: string;
};

type Profile = {
  id: string;
  name: string;
  age: number;
  heritage?: string;
  location: string;
  isActive?: boolean;
};

type AdminProfilePhoto = {
  id: string;
  url: string;
  sortOrder: number;
  isAvatar: boolean;
};

type TestResult = {
  prompt: string;
  imageUrl: string | null;
  error: string | null;
  errorDetail?: string | null;
  loading: boolean;
};

type RandomProfileResult = {
  profileId: string;
  slug: string;
  name: string;
  age: number;
  city: string;
  heritage: string;
  visualIdentityPrompt?: string;
  avatarUrl: string;
  photoUrls: string[];
  usedVerificationPhoto: boolean;
  usedHeadshotFirst: boolean;
  prompts: string[];
  favoriteFood: string;
  hobbies: string[];
  photoDescriptions: string[];
  photoPrices: number[];
  profileBio?: string;
  personality?: string;
  storage: 'supabase' | 'local';
};

export default function AdminImageTest() {
  const { loading: adminLoading } = useAdmin();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [userRequest, setUserRequest] = useState('stuur een naaktfoto van je kut');
  const [result, setResult] = useState<TestResult | null>(null);
  const [creatingRandomProfile, setCreatingRandomProfile] = useState(false);
  const [creatingBatchProfiles, setCreatingBatchProfiles] = useState(false);
  const [randomProfileResult, setRandomProfileResult] = useState<RandomProfileResult | null>(null);
  const [randomProfileError, setRandomProfileError] = useState<string | null>(null);
  const [randomBatchItems, setRandomBatchItems] = useState<RandomProfileResult[] | null>(null);
  const [randomBatchErrors, setRandomBatchErrors] = useState<{ index: number; message: string }[] | null>(
    null
  );
  const [seedingTestUser, setSeedingTestUser] = useState(false);
  const [seedUserFeedback, setSeedUserFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [adminPhotos, setAdminPhotos] = useState<AdminProfilePhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoDeletingId, setPhotoDeletingId] = useState<string | null>(null);
  const [creatingTextBatch, setCreatingTextBatch] = useState(false);
  const [textBatchItems, setTextBatchItems] = useState<TextProfileItem[] | null>(null);
  const [textBatchErrors, setTextBatchErrors] = useState<{ index: number; message: string }[] | null>(
    null
  );
  const [textBatchError, setTextBatchError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  /** Standaard aan: nieuwe profielen pas op platform na foto-upload. */
  const [inactiveUntilPhotos, setInactiveUntilPhotos] = useState(true);

  const loadProfiles = async () => {
    try {
      const profRes = await fetch('/api/admin/profiles', { credentials: 'include' });
      const profData = (await profRes.json()) as {
        profiles?: Array<{
          id: string;
          name: string;
          age: number;
          heritage?: string;
          location: string;
          isActive?: boolean;
        }>;
      };
      if (profData.profiles) {
        setProfiles(
          profData.profiles.map((p) => ({
            id: p.id,
            name: p.name,
            age: p.age,
            heritage: p.heritage,
            location: p.location,
            isActive: p.isActive,
          }))
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  const loadProfilePhotos = async (profileId: string) => {
    if (!profileId) {
      setAdminPhotos([]);
      return;
    }
    setPhotosLoading(true);
    setPhotosError(null);
    try {
      const r = await fetch(`/api/admin/profiles/${encodeURIComponent(profileId)}/photos`, {
        credentials: 'include',
      });
      const data = (await r.json()) as { photos?: AdminProfilePhoto[]; error?: string };
      if (!r.ok) throw new Error(data.error || 'Foto’s laden mislukt');
      setAdminPhotos(data.photos ?? []);
    } catch (e) {
      setAdminPhotos([]);
      setPhotosError(e instanceof Error ? e.message : 'Fout');
    } finally {
      setPhotosLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProfile) {
      setAdminPhotos([]);
      setPhotosError(null);
      return;
    }
    void loadProfilePhotos(selectedProfile);
  }, [selectedProfile]);

  const uploadProfilePhoto = async (file: File) => {
    if (!selectedProfile) return;
    setPhotoUploading(true);
    setPhotosError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(
        `/api/admin/profiles/${encodeURIComponent(selectedProfile)}/photos`,
        { method: 'POST', credentials: 'include', body: form }
      );
      const data = (await r.json()) as { photo?: AdminProfilePhoto; error?: string };
      if (!r.ok) throw new Error(data.error || 'Upload mislukt');
      await loadProfilePhotos(selectedProfile);
      await loadProfiles();
    } catch (e) {
      setPhotosError(e instanceof Error ? e.message : 'Upload mislukt');
    } finally {
      setPhotoUploading(false);
    }
  };

  const deleteProfilePhoto = async (mediaId: string) => {
    if (!selectedProfile) return;
    if (!window.confirm('Deze foto verwijderen? Dit kan niet ongedaan worden gemaakt.')) return;
    setPhotoDeletingId(mediaId);
    setPhotosError(null);
    try {
      const r = await fetch(
        `/api/admin/profiles/${encodeURIComponent(selectedProfile)}/photos`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaId }),
        }
      );
      const data = (await r.json()) as { photos?: AdminProfilePhoto[]; error?: string };
      if (!r.ok) throw new Error(data.error || 'Verwijderen mislukt');
      setAdminPhotos(data.photos ?? []);
      await loadProfiles();
    } catch (e) {
      setPhotosError(e instanceof Error ? e.message : 'Verwijderen mislukt');
    } finally {
      setPhotoDeletingId(null);
    }
  };

  const testImage = async () => {
    if (!selectedProfile || !userRequest.trim()) return;

    const profile = profiles.find((p) => p.id === selectedProfile);
    if (!profile) return;

    setResult({ prompt: '', imageUrl: null, error: null, errorDetail: null, loading: true });

    try {
      // Call the image generation directly via a new test endpoint
      const res = await fetch('/api/admin/test-image', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: selectedProfile,
          userRequest,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.detail
            ? `${data.error || 'Failed'}\n\nDetails: ${data.detail}`
            : data.error || 'Failed'
        );
      }

      setResult({
        prompt: data.prompt,
        imageUrl: data.imageUrl,
        error: null,
        errorDetail: null,
        loading: false,
      });
    } catch (e) {
      setResult({
        prompt: '',
        imageUrl: null,
        error: e instanceof Error ? e.message : 'Unknown error',
        errorDetail: null,
        loading: false,
      });
    }
  };

  const parseRandomProfileResponse = async (res: Response) => {
    const data = (await res.json()) as {
      error?: string;
      items?: RandomProfileResult[];
      errors?: { index: number; message: string }[];
    };
    if (!res.ok) {
      throw new Error(data.error || 'Random profiel aanmaken mislukt');
    }
    const items = data.items ?? [];
    const errors = data.errors ?? [];
    return { items, errors };
  };

  /** Zelfde request als één keer op "Maak random profiel aan". `everydayLook`: minder modelachtig. */
  const fetchOneRandomProfile = async (everydayLook?: boolean): Promise<RandomProfileResult> => {
    const res = await fetch('/api/admin/random-profile', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(everydayLook ? { everydayLook: true } : {}),
        inactiveUntilPhotos,
      }),
    });
    const { items } = await parseRandomProfileResponse(res);
    const first = items[0];
    if (!first) throw new Error('Geen profiel terug van server');
    return first;
  };

  const createRandomProfile = async (everydayLook?: boolean) => {
    setCreatingRandomProfile(true);
    setRandomProfileError(null);
    setRandomProfileResult(null);
    setRandomBatchItems(null);
    setRandomBatchErrors(null);
    try {
      const profile = await fetchOneRandomProfile(Boolean(everydayLook));
      setRandomProfileResult(profile);
      await loadProfiles();
    } catch (e) {
      setRandomProfileError(e instanceof Error ? e.message : 'Random profiel aanmaken mislukt');
    } finally {
      setCreatingRandomProfile(false);
    }
  };

  const seedTestSupabaseUser = async () => {
    setSeedingTestUser(true);
    setSeedUserFeedback(null);
    try {
      const res = await fetch('/api/admin/test-supabase-user', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        user?: { id: string; email: string };
      };
      if (!res.ok) {
        throw new Error(data.error || 'Insert mislukt');
      }
      const u = data.user;
      setSeedUserFeedback({
        ok: true,
        text: `${data.message ?? 'OK'} — id: ${u?.id ?? '?'} · ${u?.email ?? ''}`,
      });
    } catch (e) {
      setSeedUserFeedback({
        ok: false,
        text: e instanceof Error ? e.message : 'Onbekende fout',
      });
    } finally {
      setSeedingTestUser(false);
    }
  };

  const createTextOnlyBatch = async () => {
    setCreatingTextBatch(true);
    setTextBatchError(null);
    setTextBatchItems(null);
    setTextBatchErrors(null);
    try {
      const res = await fetch('/api/admin/text-profiles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: TEXT_PROFILE_BATCH_COUNT,
          inactiveUntilPhotos,
        }),
      });
      const data = (await res.json()) as {
        items?: TextProfileItem[];
        errors?: { index: number; message: string }[];
        error?: string;
        createdCount?: number;
      };
      if (!res.ok) throw new Error(data.error || 'Batch mislukt');
      setTextBatchItems(data.items ?? []);
      setTextBatchErrors(data.errors?.length ? data.errors : null);
      await loadProfiles();
    } catch (e) {
      setTextBatchError(e instanceof Error ? e.message : 'Batch mislukt');
    } finally {
      setCreatingTextBatch(false);
    }
  };

  const createBatchRandomProfiles = async () => {
    setCreatingBatchProfiles(true);
    setRandomProfileError(null);
    setRandomProfileResult(null);
    setRandomBatchItems(null);
    setRandomBatchErrors(null);
    const items: RandomProfileResult[] = [];
    const errors: { index: number; message: string }[] = [];
    try {
      for (let i = 0; i < RANDOM_PROFILE_BATCH_COUNT; i += 1) {
        try {
          items.push(await fetchOneRandomProfile());
        } catch (e) {
          errors.push({
            index: i,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (items.length === 0) {
        throw new Error(
          errors.map((err) => `#${err.index}: ${err.message}`).join('; ') ||
            `Alle ${RANDOM_PROFILE_BATCH_COUNT} pogingen mislukt`
        );
      }
      setRandomBatchItems(items);
      setRandomBatchErrors(errors.length > 0 ? errors : null);
      await loadProfiles();
    } catch (e) {
      setRandomProfileError(e instanceof Error ? e.message : 'Batch mislukt');
    } finally {
      setCreatingBatchProfiles(false);
    }
  };

  if (adminLoading) {
    return <p className="admin-chats-empty">Laden…</p>;
  }

  return (
    <div style={{ maxWidth: 960 }}>
        <div className="admin-panel" style={{ marginBottom: 12 }}>
          <div className="admin-panel-head">
            Stap 1 — {TEXT_PROFILE_BATCH_COUNT} Nederlandse profielen (alleen tekst)
          </div>
          <div style={{ padding: 12 }}>
          <p className="text-sm text-gray-600" style={{ marginTop: 0 }}>
            Alleen Nederlandse steden en herkomst (Nederlands). Uitgebreide bio via AI.
            Geen foto&apos;s — die upload je hieronder per profiel.
          </p>
          <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={inactiveUntilPhotos}
              onChange={(e) => setInactiveUntilPhotos(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong>Pas zichtbaar op platform na foto&apos;s</strong> — profiel blijft verborgen tot je in stap 2
              minstens één foto uploadt.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void createTextOnlyBatch()}
            disabled={creatingTextBatch || creatingBatchProfiles || creatingRandomProfile}
            className="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-sm hover:opacity-95 disabled:opacity-50 sm:w-auto"
          >
            {creatingTextBatch
              ? `${TEXT_PROFILE_BATCH_COUNT} profielen aanmaken… (1–2 min)`
              : `Maak ${TEXT_PROFILE_BATCH_COUNT} profielen aan (zonder foto's)`}
          </button>
          {textBatchError ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {textBatchError}
            </p>
          ) : null}
          {textBatchItems && textBatchItems.length > 0 ? (
            <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-xs font-semibold text-gray-700">
                {textBatchItems.length} aangemaakt
                {textBatchErrors?.length ? ` · ${textBatchErrors.length} mislukt` : ''}
              </p>
              <ul className="space-y-2 text-sm">
                {textBatchItems.map((p) => (
                  <li key={p.profileId} className="border-b border-gray-100 pb-2 last:border-0">
                    <strong>{p.name}</strong> ({p.age}) · {p.city} · {p.heritage}
                    <p className="mt-1 line-clamp-2 text-xs text-gray-600">{p.bio}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          </div>
        </div>

        <div className="admin-panel" style={{ marginBottom: 12 }}>
          <div className="admin-panel-head">Stap 2 — Foto&apos;s per profiel</div>
          <div style={{ padding: 12 }}>
          <p className="mb-4 text-sm text-gray-600">Kies een profiel, upload JPEG/PNG/WebP, of verwijder bestaande foto&apos;s.</p>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Profiel</label>
              <select
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Kies profiel…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.age}, {p.heritage || p.location})
                    {p.isActive === false ? ' · verborgen' : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedProfile ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Profielfoto&apos;s beheren</h3>
                  <button
                    type="button"
                    onClick={() => void loadProfilePhotos(selectedProfile)}
                    disabled={photosLoading}
                    className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  >
                    {photosLoading ? 'Laden…' : 'Vernieuwen'}
                  </button>
                </div>
                {photosError ? (
                  <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {photosError}
                  </p>
                ) : null}
                {photosLoading && adminPhotos.length === 0 ? (
                  <p className="text-sm text-gray-500">Foto&apos;s laden…</p>
                ) : adminPhotos.length === 0 ? (
                  <p className="text-sm text-gray-500">Geen foto&apos;s in Supabase voor dit profiel.</p>
                ) : (
                  <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {adminPhotos.map((ph) => (
                      <div key={ph.id} className="relative rounded-lg border border-gray-200 bg-white p-1.5">
                        <img
                          src={ph.url}
                          alt=""
                          className="aspect-[4/5] w-full rounded-md object-cover"
                        />
                        {ph.isAvatar ? (
                          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            Avatar
                          </span>
                        ) : null}
                        <button
                          type="button"
                          disabled={photoDeletingId === ph.id || photoUploading}
                          onClick={() => void deleteProfilePhoto(ph.id)}
                          className="mt-2 w-full rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          {photoDeletingId === ph.id ? 'Verwijderen…' : 'Verwijderen'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white px-4 py-6 hover:border-primary/50 hover:bg-primary/5">
                  <span className="text-sm font-medium text-gray-700">
                    {photoUploading ? 'Uploaden…' : 'Klik om foto te uploaden (JPEG, PNG, WebP, max 12 MB)'}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={photoUploading || !selectedProfile}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void uploadProfilePhoto(f);
                    }}
                  />
                </label>
                <p className="mt-2 text-xs text-gray-500">
                  Eerste foto in de lijst = profielavatar. Verwijderen werkt alleen voor foto&apos;s in
                  Supabase Storage.
                </p>
              </div>
            ) : null}
          </div>
          </div>
        </div>

        <details
          className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
          open={showAdvanced}
          onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-sm font-semibold text-gray-800">
            Geavanceerd — AI-foto&apos;s genereren (oud, traag)
          </summary>
          <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={inactiveUntilPhotos}
                onChange={(e) => setInactiveUntilPhotos(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Pas zichtbaar op platform na foto&apos;s (ook bij AI-profielen met gegenereerde foto&apos;s)
              </span>
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">User request (test)</label>
              <input
                type="text"
                value={userRequest}
                onChange={(e) => setUserRequest(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="test prompt"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={testImage}
                disabled={!selectedProfile || !userRequest.trim() || result?.loading}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {result?.loading ? 'Genereren…' : 'Test image'}
              </button>
              <button
                type="button"
                onClick={() => void createRandomProfile(false)}
                disabled={creatingRandomProfile || creatingBatchProfiles || creatingTextBatch}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
              >
                {creatingRandomProfile ? 'Bezig…' : '1 profiel + foto\'s'}
              </button>
              <button
                type="button"
                onClick={createBatchRandomProfiles}
                disabled={creatingRandomProfile || creatingBatchProfiles || creatingTextBatch}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
              >
                {creatingBatchProfiles
                  ? `${RANDOM_PROFILE_BATCH_COUNT} met foto's…`
                  : `${RANDOM_PROFILE_BATCH_COUNT} met foto's`}
              </button>
              <button
                type="button"
                onClick={() => void seedTestSupabaseUser()}
                disabled={seedingTestUser}
                className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50"
              >
                {seedingTestUser ? 'Bezig…' : 'Test user'}
              </button>
            </div>
            {seedUserFeedback ? (
              <p
                className={`rounded-xl border px-3 py-2 text-sm ${
                  seedUserFeedback.ok
                    ? 'border-primary/25 bg-primary/5 text-primary-deep'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {seedUserFeedback.text}
              </p>
            ) : null}
          </div>
        </details>

        {(randomProfileError || randomProfileResult) && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-lg font-semibold">Random profiel resultaat</h3>
            {randomProfileError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {randomProfileError}
              </p>
            ) : null}
            {randomProfileResult ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">
                  <strong>{randomProfileResult.name}</strong> ({randomProfileResult.age}) ·{' '}
                  {randomProfileResult.city} · {randomProfileResult.heritage}
                </p>
                <p className="text-xs text-gray-500">
                  Slug: {randomProfileResult.slug} · verificatiefoto:{' '}
                  {randomProfileResult.usedVerificationPhoto ? 'ja' : 'nee'} · eerste foto headshot:{' '}
                  {randomProfileResult.usedHeadshotFirst ? 'ja' : 'nee'} · opslag:{' '}
                  {randomProfileResult.storage}
                  {inactiveUntilPhotos ? ' · zichtbaar na foto\'s' : ' · direct zichtbaar'}
                </p>
                <p className="text-xs text-gray-600">
                  Favoriete eten: <strong>{randomProfileResult.favoriteFood}</strong> · Hobby&apos;s:{' '}
                  <strong>{randomProfileResult.hobbies.join(', ')}</strong>
                </p>
                {randomProfileResult.profileBio ? (
                  <p className="text-xs leading-relaxed text-gray-700 border border-gray-100 rounded-lg p-2 bg-gray-50">
                    <span className="font-semibold text-gray-800">Bio: </span>
                    {randomProfileResult.profileBio}
                  </p>
                ) : null}
                {randomProfileResult.personality ? (
                  <p className="text-xs text-gray-600">
                    Persoonlijkheid: <strong>{randomProfileResult.personality}</strong>
                  </p>
                ) : null}
                {randomProfileResult.visualIdentityPrompt ? (
                  <details className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                    <summary className="cursor-pointer font-semibold text-gray-800">
                      Opgeslagen visuele referentie (chat / unlock images)
                    </summary>
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
                      {randomProfileResult.visualIdentityPrompt}
                    </p>
                  </details>
                ) : null}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {randomProfileResult.photoUrls.map((url, idx) => {
                    const desc = randomProfileResult.photoDescriptions[idx] || `Foto ${idx + 1}`;
                    const price = randomProfileResult.photoPrices[idx] ?? 100;
                    return (
                      <div key={url} className="rounded-xl border border-gray-200 bg-white p-2">
                        <img
                          src={url}
                          alt="Random profiel foto"
                          className="h-56 w-full rounded-lg object-cover"
                        />
                        <p className="mt-2 text-xs font-medium text-gray-700">{desc}</p>
                        <p className="text-xs text-gray-500">Prijs: {price} credits</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {randomBatchItems && randomBatchItems.length > 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-lg font-semibold">
              Batch: {randomBatchItems.length} profiel{randomBatchItems.length === 1 ? '' : 'en'} aangemaakt
              {randomBatchErrors && randomBatchErrors.length > 0 ? (
                <span className="ml-2 text-sm font-normal text-amber-700">
                  ({randomBatchErrors.length} fout{randomBatchErrors.length === 1 ? '' : 'en'})
                </span>
              ) : null}
            </h3>
            <ul className="space-y-2 text-sm text-gray-800">
              {randomBatchItems.map((p) => (
                <li key={p.slug} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-gray-100 pb-2 last:border-0">
                  <strong>{p.name}</strong>
                  <span className="text-gray-600">
                    {p.age} · {p.city} · {p.heritage}
                  </span>
                  <span className="font-mono text-xs text-gray-500">{p.slug}</span>
                  <span className="text-xs text-gray-400">{p.storage}</span>
                </li>
              ))}
            </ul>
            {randomBatchErrors && randomBatchErrors.length > 0 ? (
              <ul className="mt-4 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                {randomBatchErrors.map((e) => (
                  <li key={e.index}>
                    <strong>#{e.index + 1}</strong> {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {result && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-lg font-semibold">Result</h3>

            {result.loading && <p className="text-gray-500">Generating image...</p>}

            {result.error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
                <p className="font-semibold mb-1">Error:</p>
                <p className="whitespace-pre-wrap">{result.error}</p>
                {result.prompt && (
                  <div className="mt-4 pt-4 border-t border-red-200">
                    <p className="text-xs font-semibold text-red-600 mb-1">Prompt sent to model:</p>
                    <p className="text-sm text-red-800 bg-red-100 p-2 rounded">{result.prompt}</p>
                  </div>
                )}
                <p className="mt-3 text-xs text-red-500">
                  The external image model (Z Image Turbo API) returned an error.
                  Check API key, credits, and task status details above.
                </p>
              </div>
            )}

            {result.prompt && (
              <div className="mb-4">
                <p className="mb-1 text-xs font-semibold uppercase text-gray-500">Generated Prompt</p>
                <p className="rounded-xl bg-gray-100 p-3 text-sm text-gray-800">{result.prompt}</p>
              </div>
            )}

            {result.imageUrl && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Generated Image</p>
                <img
                  src={result.imageUrl}
                  alt="Generated"
                  className="max-h-[600px] w-full rounded-xl border border-gray-200 object-contain"
                />
              </div>
            )}
          </div>
        )}
    </div>
  );
}
