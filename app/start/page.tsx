'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { CircularLoader } from '@/components/CircularLoader';
import { setStoredUser, getStoredUser, type StoredUser } from '@/lib/onboarding-client';
import { markShowWelcomeModal } from '@/lib/welcome-modal-client';
import { ArrowRight } from 'lucide-react';

type Step = 'splash' | 'q1' | 'q2' | 'q3' | 'loading' | 'congrats' | 'akkoord';

const VRAGEN: { id: keyof Answers; tekst: string }[] = [
  { id: 'q1', tekst: 'Ben je ouder dan 27?' },
  {
    id: 'q2',
    tekst:
      'Kun je discreet omgaan met de vrouwen? Ze hechten aan hun privacy en willen alleen contact met jou.',
  },
  {
    id: 'q3',
    tekst:
      'Kun je omgaan met vrouwen die pit hebben? De meeste zijn Oost-Europees.',
  },
];

type Answers = {
  q1: boolean | null;
  q2: boolean | null;
  q3: boolean | null;
};

export default function StartPage() {
  const [step, setStep] = useState<Step>('splash');
  const [answers, setAnswers] = useState<Answers>({ q1: null, q2: null, q3: null });
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [naam, setNaam] = useState('');
  const [email, setEmail] = useState('');
  const [leeftijd, setLeeftijd] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [discreetVink, setDiscreetVink] = useState(false);
  const [voorwaardenVink, setVoorwaardenVink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: unknown };
        if (!cancel && d.user) {
          window.location.replace('/nieuwsfeed');
          return;
        }
      } catch {
        /* ignore */
      }
      if (!cancel && getStoredUser()) window.location.replace('/nieuwsfeed');
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (step !== 'loading') return;
    setLoadingProgress(0);
    const start = Date.now();
    const duration = 3200;
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(100, Math.round((elapsed / duration) * 100));
      setLoadingProgress(p);
      if (elapsed < duration) requestAnimationFrame(tick);
      else setStep('congrats');
    };
    requestAnimationFrame(tick);
  }, [step]);

  const qIndex =
    step === 'q1' ? 0 : step === 'q2' ? 1 : step === 'q3' ? 2 : -1;

  const answerJaNee = (ja: boolean) => {
    const keys: (keyof Answers)[] = ['q1', 'q2', 'q3'];
    const current = keys[qIndex];
    if (!current) return;
    setAnswers((a) => ({ ...a, [current]: ja }));
    if (qIndex < 2) {
      setStep(keys[qIndex + 1] as Step);
    } else {
      setStep('loading');
    }
  };

  const handleGaDoor = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const age = parseInt(leeftijd, 10);
    if (!naam.trim() || !email.trim()) {
      setError('Vul je naam en e-mailadres in.');
      return;
    }
    if (!email.includes('@')) {
      setError('Vul een geldig e-mailadres in.');
      return;
    }
    if (!Number.isFinite(age) || age < 18) {
      setError('Je moet minimaal 18 jaar zijn.');
      return;
    }
    if (wachtwoord.length < 8) {
      setError('Kies een wachtwoord van minimaal 8 tekens.');
      return;
    }
    setStep('akkoord');
  };

  const handleFinalSubmit = async () => {
    setError(null);
    if (!discreetVink || !voorwaardenVink) {
      setError('Vink beide opties aan om door te gaan.');
      return;
    }
    const age = parseInt(leeftijd, 10);
    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          naam: naam.trim(),
          email: email.trim().toLowerCase(),
          leeftijd: age,
          wachtwoord,
          discreetAkkoord: discreetVink,
          voorwaardenAkkoord: voorwaardenVink,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
      const user: StoredUser = {
        naam: naam.trim(),
        email: email.trim().toLowerCase(),
        leeftijd: age,
        discreetAkkoord: discreetVink,
        voorwaardenAkkoord: voorwaardenVink,
        completedAt: new Date().toISOString(),
      };
      setStoredUser(user);
      markShowWelcomeModal();
      window.location.assign('/nieuwsfeed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt. Probeer opnieuw.');
    } finally {
      setSubmitting(false);
    }
  };

  const showVraagVoettekst =
    step === 'q1' || step === 'q2' || step === 'q3';

  return (
    <div className="min-h-screen bg-[var(--onboarding-bg)] flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 max-w-lg mx-auto w-full">
        {step === 'splash' && (
          <div className="text-center w-full">
            <div className="flex justify-center mb-12">
              <Logo variant="hero" />
            </div>
            <p className="text-gray-600 mb-10 text-lg leading-relaxed font-medium">
              Welkom. Een paar korte vragen — discreet, respectvol en zonder gedoe.
            </p>
            <button
              type="button"
              onClick={() => setStep('q1')}
              className="w-full max-w-md mx-auto flex items-center justify-center gap-3 py-5 px-8 rounded-full bg-primary text-white font-semibold text-lg shadow-lg shadow-primary/30 hover:bg-primary-hover active:scale-[0.99] transition-all"
            >
              Beginnen
              <ArrowRight className="w-5 h-5" />
            </button>
            <p className="mt-8 text-sm text-gray-500">
              Al een account?{' '}
              <Link href="/inloggen" className="text-primary font-semibold underline">
                Inloggen
              </Link>
            </p>
            <p className="mt-4 text-sm text-gray-500 flex items-center justify-center gap-2">
              <span aria-hidden>🕒</span>
              Meedoen duurt maar 1 minuut
            </p>
          </div>
        )}

        {(step === 'q1' || step === 'q2' || step === 'q3') && (
          <div className="w-full space-y-8">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <p className="text-center text-sm font-semibold text-gray-600">
              Vraag {qIndex + 1} van {VRAGEN.length}
            </p>
            <h2 className="text-center text-xl md:text-2xl font-semibold text-gray-900 leading-snug px-1">
              {VRAGEN[qIndex]?.tekst}
            </h2>
            <div className="flex flex-col gap-4 pt-2 max-w-md mx-auto w-full">
              <button
                type="button"
                onClick={() => answerJaNee(true)}
                className="group w-full flex items-center justify-between py-5 px-8 rounded-full bg-primary text-white font-semibold text-lg shadow-md shadow-primary/25 hover:bg-primary-hover active:scale-[0.99] transition-all"
              >
                Ja
                <ArrowRight className="w-5 h-5 opacity-90 group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                type="button"
                onClick={() => answerJaNee(false)}
                className="group w-full flex items-center justify-between py-5 px-8 rounded-full border-2 border-gray-300/80 bg-white text-gray-800 font-semibold text-lg hover:bg-gray-50 active:scale-[0.99] transition-all"
              >
                Nee
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
            {showVraagVoettekst && (
              <p className="text-center text-sm text-gray-500 flex items-center justify-center gap-2 pt-4">
                <span aria-hidden>🕒</span>
                Meedoen duurt maar 1 minuut
              </p>
            )}
          </div>
        )}

        {step === 'loading' && (
          <div className="w-full text-center space-y-10">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <CircularLoader progress={loadingProgress} />
            <p className="text-lg font-medium text-gray-800 px-2">
              We kijken of je in aanmerking komt voor de vrouwen…
            </p>
          </div>
        )}

        {step === 'congrats' && (
          <div className="w-full space-y-6 max-w-md mx-auto px-1">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <p className="text-center text-lg text-gray-800 leading-relaxed">
              Je komt in aanmerking om <span className="font-semibold">discrete meisjes</span> gratis
              te proberen.
            </p>
            <form onSubmit={handleGaDoor} className="space-y-4 text-left">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-2xl px-4 py-2 border-2 border-red-100">
                  {error}
                </p>
              )}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Naam</span>
                <input
                  required
                  value={naam}
                  onChange={(e) => setNaam(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--surface-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="Je voornaam of bijnaam"
                  autoComplete="name"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">E-mail</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--surface-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="jij@voorbeeld.nl"
                  autoComplete="email"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Leeftijd</span>
                <input
                  required
                  type="number"
                  min={18}
                  max={99}
                  value={leeftijd}
                  onChange={(e) => setLeeftijd(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--surface-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="18+"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Wachtwoord</span>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={wachtwoord}
                  onChange={(e) => setWachtwoord(e.target.value)}
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--surface-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="Minimaal 8 tekens"
                  autoComplete="new-password"
                />
              </label>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-3 py-5 px-8 rounded-full bg-primary text-white font-semibold text-lg shadow-lg shadow-primary/30 hover:bg-primary-hover transition-all"
              >
                Ga door
                <ArrowRight className="w-5 h-5" />
              </button>
            </form>
          </div>
        )}

        {step === 'akkoord' && (
          <div className="w-full space-y-6 max-w-md mx-auto">
            <div className="flex justify-center mb-2">
              <Logo variant="hero" className="scale-75" />
            </div>
            <h2 className="text-xl font-bold text-center text-gray-900">Laatste stap</h2>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-2xl px-4 py-2 border-2 border-red-100">
                {error}
              </p>
            )}
            <label className="flex gap-3 items-start cursor-pointer rounded-2xl bg-[var(--surface-card)] p-4 border-2 border-gray-300 shadow-sm">
              <input
                type="checkbox"
                checked={discreetVink}
                onChange={(e) => setDiscreetVink(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-gray-400 text-primary focus:ring-primary"
              />
              <span className="text-sm text-gray-800 leading-relaxed">
                Ik ga discreet omgaan en respecteer de privacy van de vrouwen.
              </span>
            </label>
            <label className="flex gap-3 items-start cursor-pointer rounded-2xl bg-[var(--surface-card)] p-4 border-2 border-gray-300 shadow-sm">
              <input
                type="checkbox"
                checked={voorwaardenVink}
                onChange={(e) => setVoorwaardenVink(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-gray-400 text-primary focus:ring-primary"
              />
              <span className="text-sm text-gray-800 leading-relaxed">
                Ik ga akkoord met de{' '}
                <Link href="/voorwaarden" className="text-primary font-semibold underline">
                  algemene voorwaarden
                </Link>
                .
              </span>
            </label>
            <button
              type="button"
              disabled={submitting}
              onClick={handleFinalSubmit}
              className="w-full py-6 md:py-7 rounded-full bg-primary text-white font-bold text-xl shadow-lg shadow-primary/30 hover:bg-primary-hover disabled:opacity-60 transition-all border-2 border-primary-hover/30"
            >
              {submitting ? 'Even geduld…' : 'Ik wil het proberen'}
            </button>
          </div>
        )}
      </div>

      <footer className="py-6 text-center text-xs text-gray-500 px-4 border-t-2 border-gray-300/60 bg-[#cfd3dc]">
        discreetemeisjes.nl · 18+ · Vertrouwen &amp; discretie
      </footer>
    </div>
  );
}
