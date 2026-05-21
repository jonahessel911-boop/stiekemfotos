'use client';

import React, { useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';
import { setStoredUser } from '@/lib/onboarding-client';

type Phase = 'loading' | 'intro' | 'step1' | 'step2' | 'step3' | 'password' | 'done' | 'error';

const STEPS: { id: Exclude<Phase, 'loading' | 'intro' | 'password' | 'done' | 'error'>; title: string; body: string }[] = [
  {
    id: 'step1',
    title: 'Kies met wie je wilt praten',
    body: 'Bekijk profielen en ontdek wie online is. Je hoeft niet perfect te zijn — kies gewoon iemand die je aanspreekt.',
  },
  {
    id: 'step2',
    title: 'Stuur een bericht',
    body: 'Chat wanneer jij wilt. Een hoi, een vraag of een compliment is genoeg om een gesprek te starten.',
  },
  {
    id: 'step3',
    title: 'Spreek af wanneer het klikt',
    body: 'Blijf chatten en zie waar het heen gaat. Jij bepaalt het tempo — van leuk gesprek tot afspreken.',
  },
];

function nextPhase(phase: Phase): Phase {
  if (phase === 'intro') return 'step1';
  if (phase === 'step1') return 'step2';
  if (phase === 'step2') return 'step3';
  if (phase === 'step3') return 'password';
  return phase;
}

function stepIndex(phase: Phase): number {
  if (phase === 'step1') return 0;
  if (phase === 'step2') return 1;
  if (phase === 'step3') return 2;
  return -1;
}

export default function PlatformSetupPage() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [naam, setNaam] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotFlow, setForgotFlow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token')?.trim() ?? '';
    setForgotFlow(params.get('flow') === 'reset');
    setToken(t);
    if (!t) {
      setPhase('error');
      setError('Ongeldige link. Open de link uit je e-mail opnieuw.');
      return;
    }

    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/auth/setup-token?token=${encodeURIComponent(t)}`);
        const data = (await res.json()) as { email?: string; naam?: string; error?: string };
        if (cancel) return;
        if (!res.ok) {
          setPhase('error');
          setError(data.error || 'Link ongeldig of verlopen.');
          return;
        }
        setEmail(data.email ?? '');
        setNaam(data.naam ?? '');
        setPhase(params.get('flow') === 'reset' ? 'password' : 'intro');
      } catch {
        if (!cancel) {
          setPhase('error');
          setError('Kon je gegevens niet laden. Probeer het later opnieuw.');
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Kies een wachtwoord van minimaal 8 tekens.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: { id: string; naam: string; email: string; leeftijd: number; createdAt: string };
      };
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
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
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout');
    } finally {
      setBusy(false);
    }
  };

  const goPlatform = () => {
    window.location.href = forgotFlow ? '/login' : '/profielen';
  };

  const idx = stepIndex(phase);
  const currentStep = idx >= 0 ? STEPS[idx] : null;

  return (
    <div className="min-h-screen bg-[var(--auth-shell-bg)] pb-24">
      <div className="pt-10 max-w-md mx-auto px-4">
        <div className="flex justify-center mb-6">
          <Logo variant="hero" className="scale-90" />
        </div>

        {phase === 'loading' && (
          <p className="text-center text-sm text-gray-600">Even laden…</p>
        )}

        {phase === 'error' && (
          <div className="rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5 space-y-4">
            <h1 className="text-xl font-bold text-gray-900 text-center">Link niet geldig</h1>
            <p className="text-sm text-gray-700 text-center">{error}</p>
            <Link
              href="/login"
              className="block w-full text-center rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover"
            >
              Naar inloggen
            </Link>
          </div>
        )}

        {phase === 'intro' && (
          <div className="rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5 space-y-5">
            <h1 className="text-2xl font-bold text-gray-900 text-center">
              {naam ? `Welkom, ${naam}` : 'Welkom op het platform'}
            </h1>
            <p className="text-sm text-gray-700 text-center leading-relaxed">
              Je bent binnen. In drie korte stappen leggen we uit hoe het werkt — daarna maak je je
              wachtwoord aan en kun je meteen beginnen.
            </p>
            <button
              type="button"
              onClick={() => setPhase('step1')}
              className="w-full rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover"
            >
              Volgende
            </button>
          </div>
        )}

        {currentStep && (
          <div className="rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5 space-y-5">
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-primary">
              Stap {idx + 1} van 3
            </p>
            <h1 className="text-xl font-bold text-gray-900 text-center">{currentStep.title}</h1>
            <p className="text-sm text-gray-700 text-center leading-relaxed">{currentStep.body}</p>
            <div className="flex gap-2 justify-center">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className={`h-2 w-2 rounded-full ${dot === idx ? 'bg-primary' : 'bg-gray-200'}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPhase(nextPhase(phase))}
              className="w-full rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover"
            >
              {phase === 'step3' ? 'Wachtwoord aanmaken' : 'Volgende'}
            </button>
          </div>
        )}

        {phase === 'password' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-gray-900 text-center">
              {forgotFlow ? 'Nieuw wachtwoord' : 'Wachtwoord aanmaken'}
            </h1>
            <p className="text-sm text-gray-600 text-center mb-2">
              {forgotFlow
                ? 'Kies een nieuw wachtwoord voor je account.'
                : 'Laatste stap — daarna ga je direct naar het platform.'}
            </p>
            <form
              onSubmit={submitPassword}
              className="space-y-4 rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5"
            >
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 border border-red-100">
                  {error}
                </p>
              )}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">E-mailadres</span>
                <input
                  type="email"
                  readOnly
                  value={email}
                  className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[16px] text-gray-700"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Wachtwoord</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimaal 8 tekens"
                  className="mt-1.5 w-full rounded-xl border border-gray-200 px-4 py-3 text-[16px]"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !token}
                className="w-full rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover disabled:opacity-60"
              >
                {busy ? 'Bezig…' : forgotFlow ? 'Wachtwoord opslaan' : 'Ga naar platform'}
              </button>
            </form>
          </div>
        )}

        {phase === 'done' && (
          <div className="rounded-2xl border border-primary/15 bg-[var(--onboarding-card)] p-6 shadow-md shadow-primary/5 space-y-4">
            <h1 className="text-xl font-bold text-gray-900 text-center">Je bent klaar</h1>
            <p className="text-sm text-gray-700 text-center">
              Je wachtwoord staat. Bekijk wie er online is en stuur je eerste bericht.
            </p>
            <button
              type="button"
              onClick={goPlatform}
              className="w-full rounded-full bg-primary py-4 font-semibold text-white shadow-md hover:bg-primary-hover"
            >
              {forgotFlow ? 'Naar inloggen' : 'Ga naar platform'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
