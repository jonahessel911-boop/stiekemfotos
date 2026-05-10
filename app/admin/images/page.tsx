'use client';

import React, { useEffect, useState } from 'react';

/** Aantal profielen bij “batch random” op /admin/images */
const RANDOM_PROFILE_BATCH_COUNT = 50;

type Profile = {
  id: string;
  name: string;
  age: number;
  heritage?: string;
  location: string;
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
  const [authorized, setAuthorized] = useState(false);
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

  const loadProfiles = async () => {
    try {
      const r = await fetch('/api/admin/overview', { credentials: 'include' });
      if (r.status === 401) {
        setAuthorized(false);
        return;
      }
      const data = await r.json();
      // Get unique profiles from conversations
      const profileSet = new Map<string, Profile>();
      // We need to fetch profiles separately
      const profRes = await fetch('/api/profiles', { credentials: 'include' });
      const profData = await profRes.json();
      if (profData.profiles) {
        setProfiles(profData.profiles);
      }
      setAuthorized(true);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

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
      body: JSON.stringify(everydayLook ? { everydayLook: true } : {}),
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

  if (!authorized) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-gray-600">Log in via /admin first</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">AI Image Generator Test</h1>
          <a href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Admin
          </a>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Test Nude Picture Generation</h2>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Profile</label>
              <select
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select a profile...</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.age}, {p.heritage || 'unknown'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">User Request</label>
              <input
                type="text"
                value={userRequest}
                onChange={(e) => setUserRequest(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="stuur een naaktfoto van je kut"
              />
            </div>

            <button
              onClick={testImage}
              disabled={!selectedProfile || !userRequest.trim() || result?.loading}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {result?.loading ? 'Generating...' : 'Generate Image'}
            </button>
            <button
              onClick={() => void createRandomProfile(false)}
              disabled={creatingRandomProfile || creatingBatchProfiles}
              className="ml-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {creatingRandomProfile ? 'Profiel maken...' : 'Maak random profiel aan'}
            </button>
            <button
              type="button"
              onClick={() => void createRandomProfile(true)}
              disabled={creatingRandomProfile || creatingBatchProfiles}
              className="ml-2 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              title="Grok + image prompts gericht op gewone uitstraling, minder glamour-model"
            >
              {creatingRandomProfile ? 'Profiel maken...' : 'Random profiel (minder knap)'}
            </button>
            <button
              type="button"
              onClick={createBatchRandomProfiles}
              disabled={creatingRandomProfile || creatingBatchProfiles}
              className="ml-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {creatingBatchProfiles
                ? `${RANDOM_PROFILE_BATCH_COUNT} profielen… (kan lang duren)`
                : `Maak ${RANDOM_PROFILE_BATCH_COUNT} random profielen`}
            </button>
            <button
              type="button"
              onClick={() => void seedTestSupabaseUser()}
              disabled={seedingTestUser}
              className="ml-2 rounded-xl border-2 border-primary bg-white px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-50"
            >
              {seedingTestUser ? 'Bezig…' : 'Schiet test gebruiker in'}
            </button>
          </div>
          {seedUserFeedback ? (
            <p
              className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                seedUserFeedback.ok
                  ? 'border-primary/25 bg-primary/5 text-primary-deep'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {seedUserFeedback.text}
            </p>
          ) : null}
        </div>

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
    </main>
  );
}
