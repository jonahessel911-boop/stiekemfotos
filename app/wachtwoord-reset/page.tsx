'use client';

import React, { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';

export default function WachtwoordResetPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('token')?.trim() ?? '';
    setToken(t);
    if (!t) setError('Ongeldige link. Open de link uit je e-mail opnieuw.');
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Minimaal 8 tekens.');
      return;
    }
    if (password !== password2) {
      setError('Wachtwoorden komen niet overeen.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--auth-shell-bg)] pb-24">
      <div className="pt-10 max-w-md mx-auto px-4">
        <div className="flex justify-center mb-6">
          <Logo variant="hero" className="scale-90" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Nieuw wachtwoord</h1>
        <p className="text-sm text-gray-600 text-center mb-8">Kies een nieuw wachtwoord voor je account.</p>

        {done ? (
          <div className="rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5 space-y-4">
            <p className="text-sm text-gray-700">Je wachtwoord is bijgewerkt. Je kunt nu inloggen.</p>
            <Link
              href="/inloggen"
              className="block w-full text-center rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover"
            >
              Naar inloggen
            </Link>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-4 rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5"
          >
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 border border-red-100">
                {error}
              </p>
            )}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Nieuw wachtwoord</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 text-[16px]"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Herhaal wachtwoord</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 text-[16px]"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !token}
              className="w-full rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover disabled:opacity-60"
            >
              {busy ? 'Bezig…' : 'Wachtwoord opslaan'}
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
