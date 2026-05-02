'use client';

import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

const STEPS = ['Naam & leeftijd', 'Woonplaats', 'Over jou', 'Voorkeuren'] as const;

export default function KwalificatiePage() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const next = () => {
    setErr(null);
    if (step === 0) {
      if (!name.trim() || !age) {
        setErr('Vul naam en leeftijd in.');
        return;
      }
      if (Number(age) < 18) {
        setErr('Je moet minimaal 18 zijn.');
        return;
      }
    }
    if (step === 1 && !city.trim()) {
      setErr('Vul je woonplaats in.');
      return;
    }
    if (step === 2 && !bio.trim()) {
      setErr('Vertel iets over jezelf.');
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const submit = async () => {
    if (!lookingFor.trim()) {
      setErr('Beschrijf kort wat je zoekt.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/qualification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          age: Number(age),
          city: city.trim(),
          bio: bio.trim(),
          lookingFor: lookingFor.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fout');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-24 relative">
      {saving && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 p-4">
          <div className="bg-[var(--surface-card)] rounded-2xl p-8 shadow-xl border-2 border-gray-300 flex flex-col items-center gap-5 min-w-[200px]">
            <div className="w-14 h-14 border-4 border-gray-200 border-t-primary rounded-full animate-spin" />
            <p className="text-sm font-semibold text-gray-700">Opslaan…</p>
          </div>
        </div>
      )}
      <Navbar />
      <div className="pt-20 max-w-lg mx-auto px-4 py-8">
        <p className="text-xs uppercase tracking-wider text-primary font-semibold mb-2">
          Kwalificatie
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Even kennismaken
        </h1>
        <p className="text-gray-600 text-sm mb-8">
          Zo matchen we je beter — alles blijft discreet.
        </p>

        <div className="flex gap-1 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-gray-200'}`}
            />
          ))}
        </div>

        {err && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{err}</div>
        )}

        {done ? (
          <div className="bg-white rounded-2xl p-6 border border-gray-100 text-center">
            <p className="text-lg font-semibold text-gray-900 mb-2">Bedankt!</p>
            <p className="text-gray-600 text-sm mb-6">
              Je gegevens zijn opgeslagen. Ontdek nu profielen.
            </p>
            <Link
              href="/profielen"
              className="inline-flex w-full justify-center rounded-2xl bg-primary py-3 font-semibold text-white"
            >
              Naar profielen
            </Link>
          </div>
        ) : (
          <>
            {step === 0 && (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Naam of bijnaam</span>
                  <input
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Hoe mogen we je noemen?"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Leeftijd</span>
                  <input
                    type="number"
                    min={18}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="18+"
                  />
                </label>
              </div>
            )}
            {step === 1 && (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Woonplaats</span>
                <input
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Bijv. Amsterdam"
                />
              </label>
            )}
            {step === 2 && (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Kort over jou</span>
                <textarea
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 min-h-[120px]"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Wat vind je leuk? Wat zoek je op het platform?"
                />
              </label>
            )}
            {step === 3 && (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Wat zoek je?</span>
                <textarea
                  className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 min-h-[100px]"
                  value={lookingFor}
                  onChange={(e) => setLookingFor(e.target.value)}
                  placeholder="Bijv. een leuke date, chat, of meer…"
                />
              </label>
            )}

            <div className="flex gap-3 mt-8">
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep((s) => s - 1)}
                >
                  Terug
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button type="button" className="flex-1" onClick={next}>
                  Volgende
                </Button>
              ) : (
                <Button type="button" className="flex-1" onClick={submit} disabled={saving}>
                  {saving ? 'Opslaan…' : 'Afronden'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
