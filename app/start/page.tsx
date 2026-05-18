'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { CircularLoader } from '@/components/CircularLoader';
import { ArrowRight, Check } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import ClickFlareLanderScript from '@/components/ClickFlareLanderScript';

const CTA_URL = 'https://911-for-me.com/cf/click';

type Step =
  | 'splash'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'zoekEigenschappen'
  | 'loadingMatches'
  | 'signupForm';

/** Drie ja/nee-vragen + eigenschappen */
const ONBOARDING_VRAAG_TOTAAL = 4;

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
      'Deze vrouwen houden van persoonlijk contact, en als je er een goede connectie mee hebt zijn ze soms ook bereid om pikante foto\u2019s te sturen. Ben je hier oké mee?',
  },
];

const EIGENSCHAP_OPTIES = [
  { id: 'goede-rondingen', label: 'Goede rondingen' },
  { id: 'gezellig', label: 'Gezellig' },
  { id: 'gevoelig', label: 'Gevoelig' },
  { id: 'discreet', label: 'Discreet' },
  { id: 'speels', label: 'Speels' },
  { id: 'sexy', label: 'Sexy' },
  { id: 'sexueel-actief', label: 'Sexueel actief' },
  { id: 'onduigend', label: 'Onduigend' },
] as const;

type Answers = {
  q1: boolean | null;
  q2: boolean | null;
  q3: boolean | null;
};

function randomMatchCount(): number {
  return Math.floor(11 + Math.random() * (50 - 11 + 1));
}

export default function StartPage() {
  const [step, setStep] = useState<Step>('splash');
  const [answers, setAnswers] = useState<Answers>({
    q1: null,
    q2: null,
    q3: null,
  });
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [eigenschapIds, setEigenschapIds] = useState<Set<string>>(() => new Set());
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: unknown };
        if (!cancel && d.user) {
          window.location.replace('/profielen');
          return;
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (step !== 'loadingMatches') return;
    setLoadingProgress(0);
    const start = Date.now();
    const duration = 3800;
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(100, Math.round((elapsed / duration) * 100));
      setLoadingProgress(p);
      if (elapsed < duration) requestAnimationFrame(tick);
      else {
        const base = randomMatchCount();
        const preferenceBonus = Math.min(6, Math.max(0, eigenschapIds.size - 1));
        setMatchCount(Math.min(50, base + preferenceBonus));
        setStep('signupForm');
      }
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
    if (qIndex < keys.length - 1) {
      setStep(keys[qIndex + 1] as Step);
    } else {
      setStep('zoekEigenschappen');
    }
  };

  const toggleEigenschap = (id: string) => {
    setEigenschapIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleEigenschappenNext = () => {
    setError(null);
    if (eigenschapIds.size === 0) {
      setError('Kies minimaal één eigenschap.');
      return;
    }
    setStep('loadingMatches');
  };

  const showVraagVoettekst =
    step === 'q1' || step === 'q2' || step === 'q3';

  return (
    <div className="min-h-screen bg-[var(--onboarding-bg)] flex flex-col">
      <ClickFlareCapture />
      <ClickFlareLanderScript />
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 max-w-lg mx-auto w-full">
        {step === 'splash' && (
          <div className="text-center w-full">
            <div className="flex justify-center mb-12">
              <Logo variant="hero" />
            </div>
            <p className="text-gray-600 mb-10 text-lg leading-relaxed font-medium">
              Welkom op stiekemefotos.nl. Een paar korte vragen en je bent er.
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
              Vraag {qIndex + 1} van {ONBOARDING_VRAAG_TOTAAL}
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

        {step === 'zoekEigenschappen' && (
          <div className="w-full space-y-6 max-w-md mx-auto">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <p className="text-center text-sm font-semibold text-gray-600">
              Vraag 4 van {ONBOARDING_VRAAG_TOTAAL}
            </p>
            <div>
              <h2 className="text-center text-xl md:text-2xl font-semibold text-gray-900 leading-snug">
                Waarin moeten deze vrouwen voldoen?
              </h2>
              <p className="text-center text-sm text-gray-600 mt-2">
                Meerdere antwoorden mogelijk.
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-2xl px-4 py-2 border-2 border-red-100">
                {error}
              </p>
            )}
            <div className="space-y-2">
              {EIGENSCHAP_OPTIES.map((opt) => {
                const on = eigenschapIds.has(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleEigenschap(opt.id)}
                    className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-all ${
                      on
                        ? 'border-primary bg-primary/10'
                        : 'border-gray-300 bg-[var(--onboarding-card)] hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                        on ? 'border-primary bg-primary text-white' : 'border-gray-400 bg-white'
                      }`}
                    >
                      {on && <Check className="h-4 w-4" strokeWidth={3} />}
                    </span>
                    <span className="font-medium text-gray-900">{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('q3')}
                className="flex-1 py-4 rounded-full border-2 border-gray-300 bg-white font-semibold text-gray-800"
              >
                Terug
              </button>
              <button
                type="button"
                onClick={handleEigenschappenNext}
                className="flex-1 py-4 rounded-full bg-primary text-white font-semibold shadow-md"
              >
                Zoeken
              </button>
            </div>
          </div>
        )}

        {step === 'loadingMatches' && (
          <div className="w-full text-center space-y-10">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <CircularLoader progress={loadingProgress} />
            <p className="text-lg font-medium text-gray-800 px-2 leading-relaxed">
              We zijn vrouwen aan het zoeken die bij je wensen passen…..
            </p>
            {eigenschapIds.size > 0 ? (
              <p className="text-sm text-gray-600 px-2">
                {eigenschapIds.size}{' '}
                {eigenschapIds.size === 1 ? 'wens' : 'wensen'} geselecteerd
              </p>
            ) : null}
          </div>
        )}

        {step === 'signupForm' && (
          <div className="w-full space-y-8 max-w-md mx-auto px-1 text-center">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            {matchCount != null && (
              <p className="text-balance text-2xl md:text-3xl font-extrabold leading-tight tracking-tight text-gray-900 px-2">
                Er zijn{' '}
                <span className="text-primary tabular-nums">{matchCount}</span>{' '}
                vrouwen die wachten om benaderd te worden door mannen als jij.
              </p>
            )}
            <a
              href={CTA_URL}
              className="w-full flex items-center justify-center gap-3 py-5 px-8 rounded-full bg-primary text-white font-semibold text-lg shadow-lg shadow-primary/30 hover:bg-primary-hover active:scale-[0.99] transition-all"
            >
              Bekijk vrouwen
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>
        )}
      </div>

      <footer className="py-6 text-center text-xs text-gray-600 px-4 border-t border-primary/15 bg-[var(--onboarding-footer-bg)]">
        stiekemefotos.nl · 18+ · Vertrouwen &amp; discretie
      </footer>
    </div>
  );
}
