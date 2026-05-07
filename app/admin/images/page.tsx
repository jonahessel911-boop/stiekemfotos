'use client';

import React, { useEffect, useState } from 'react';

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
  loading: boolean;
};

export default function AdminImageTest() {
  const [authorized, setAuthorized] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [userRequest, setUserRequest] = useState('stuur een naaktfoto van je kut');
  const [result, setResult] = useState<TestResult | null>(null);

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

    setResult({ prompt: '', imageUrl: null, error: null, loading: true });

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
      if (!res.ok) throw new Error(data.error || 'Failed');

      setResult({
        prompt: data.prompt,
        imageUrl: data.imageUrl,
        error: null,
        loading: false,
      });
    } catch (e) {
      setResult({
        prompt: '',
        imageUrl: null,
        error: e instanceof Error ? e.message : 'Unknown error',
        loading: false,
      });
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
          </div>
        </div>

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
                  The external image model (Hugging Face Space) is currently returning errors. 
                  This can happen when the model is overloaded or has temporary issues.
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
