'use client';

import React, { useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';

export default function WachtwoordVergetenPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error || 'Verzoek mislukt');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-24">
      <div className="pt-10 max-w-md mx-auto px-4">
        <div className="flex justify-center mb-6">
          <Logo variant="hero" className="scale-90" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Wachtwoord vergeten</h1>
        <p className="text-sm text-gray-600 text-center mb-8">
          Vul je e-mailadres in. Je ontvangt een link om een nieuw wachtwoord te kiezen.
        </p>

        {done ? (
          <div className="bg-[var(--surface-card)] rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
            <p className="text-sm text-gray-700">
              Als dit e-mailadres bij ons bekend is, ontvang je zo een mail met een link. Controleer ook
              je spam.
            </p>
            <Link
              href="/inloggen"
              className="block w-full text-center rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover"
            >
              Terug naar inloggen
            </Link>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-4 bg-[var(--surface-card)] rounded-2xl border border-gray-200 p-6 shadow-sm"
          >
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 border border-red-100">
                {error}
              </p>
            )}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">E-mail</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 text-[16px]"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Bezig…' : 'Verstuur link'}
            </button>
            <p className="text-center text-sm">
              <Link href="/inloggen" className="text-primary font-semibold underline">
                Terug naar inloggen
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
