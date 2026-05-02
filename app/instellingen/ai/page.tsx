'use client';

import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';

export default function AiInstellingenPage() {
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [pin, setPin] = useState('');
  const [hasPin, setHasPin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ai-settings')
      .then((r) => r.json())
      .then((d) => {
        setPrompt(d.systemPrompt || '');
        setDefaultPrompt(d.defaultPrompt || '');
        setHasPin(d.hasPin);
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pin ? { 'x-settings-pin': pin } : {}),
        },
        body: JSON.stringify({ systemPrompt: prompt, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
      setMsg('Opgeslagen.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <Navbar />
      <div className="pt-20 max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">AI-systeemprompt</h1>
        <p className="text-gray-600 text-sm mb-6">
          Dit bepaalt hoe Grok antwoordt namens profielen in de chat. Combineer met je
          merkstem en compliance-regels.
        </p>

        {loading ? (
          <p className="text-gray-500">Laden…</p>
        ) : (
          <>
            {hasPin && (
              <label className="block mb-4">
                <span className="text-sm font-medium">PIN (uit .env: INSTELLINGEN_PIN)</span>
                <input
                  type="password"
                  className="mt-1 w-full max-w-xs rounded-xl border border-gray-200 px-4 py-2"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                />
              </label>
            )}

            <label className="block mb-2">
              <span className="text-sm font-medium text-gray-700">Actieve prompt</span>
              <textarea
                className="mt-1 w-full min-h-[280px] rounded-2xl border border-gray-200 p-4 font-mono text-sm"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>

            <details className="mb-6 text-sm text-gray-500">
              <summary className="cursor-pointer">Standaard prompt (referentie)</summary>
              <pre className="mt-2 p-4 bg-gray-100 rounded-xl overflow-auto text-xs">
                {defaultPrompt}
              </pre>
            </details>

            {msg && <p className="text-sm mb-4 text-gray-700">{msg}</p>}

            <Button type="button" onClick={save} disabled={saving}>
              {saving ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
