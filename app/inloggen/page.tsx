'use client';

import React, { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import { setStoredUser } from '@/lib/onboarding-client';
import Link from 'next/link';

export default function InloggenPage() {
  const getQueryParam = (key: string) => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get(key)?.trim() ?? '';
  };
  const getNextUrl = () => {
    if (typeof window === 'undefined') return '/profielen';
    const raw = new URLSearchParams(window.location.search).get('next')?.trim();
    if (!raw || !raw.startsWith('/')) return '/profielen';
    return raw;
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      const d = (await r.json()) as { user?: { naam: string; email: string; leeftijd: number } };
      if (!cancel && d.user) window.location.replace(getNextUrl());
    })();
    const verifyPending = getQueryParam('verify_pending') === '1';
    const verified = getQueryParam('verified');
    const prefEmail = getQueryParam('email');
    if (prefEmail) setEmail(prefEmail);
    if (verifyPending) {
      setNotice(
        'Je hebt een e-mail ontvangen die je moet bevestigen om de discreete meisjes te zien.'
      );
    } else if (verified === '1') {
      setNotice('Je e-mail is bevestigd. Je kunt nu inloggen.');
    } else if (verified === '0') {
      setError('Verificatielink ongeldig of verlopen. Vraag een nieuwe e-mail aan.');
    }
    return () => {
      cancel = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: { id: string; naam: string; email: string; leeftijd: number; createdAt: string };
        needsEmailVerification?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Inloggen mislukt');
      }
      if (data.user) {
        setStoredUser({
          id: data.user.id,
          naam: data.user.naam,
          email: data.user.email,
          leeftijd: data.user.leeftijd,
          discreetAkkoord: true,
          voorwaardenAkkoord: true,
          completedAt: data.user.createdAt,
        });
      }
      /** Volledige document-load voorkomt ontbrekende CSS na client-only navigatie (Next 15). */
      window.location.assign(getNextUrl());
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
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">Inloggen</h1>
        <p className="text-sm text-gray-600 text-center mb-8">
          Gebruik het e-mailadres en wachtwoord van je account.
        </p>
        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5"
        >
          {notice && (
            <p className="text-sm text-blue-700 bg-blue-50 rounded-xl px-4 py-2 border border-blue-100">
              {notice}
            </p>
          )}
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
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Wachtwoord</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 text-[16px]"
            />
          </label>
          <p className="text-right text-sm">
            <Link href="/wachtwoord-vergeten" className="text-primary font-semibold underline">
              Wachtwoord vergeten?
            </Link>
          </p>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover disabled:opacity-60"
          >
            {busy ? 'Bezig…' : 'Log in'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-8">
          Nog geen account?{' '}
          <Link href="/start" className="text-primary font-semibold underline">
            Start hier
          </Link>
        </p>
      </div>
    </div>
  );
}
