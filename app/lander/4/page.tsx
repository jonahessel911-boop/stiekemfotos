'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircularLoader } from '@/components/CircularLoader';
import { ArrowRight, Check } from 'lucide-react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import './lander-4.css';

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
      'Deze vrouwen houden van persoonlijk contact, en vinden een goede connectie belangrijk en geil. Ben je daar oke mee?',
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

export default function Lander4Page() {
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
    <div className="lander-4-theme flex flex-col">
      <ClickFlareCapture />
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 max-w-lg mx-auto w-full">
        {step === 'splash' && (
          <div className="text-center w-full">
            <p className="text-gray-800 mb-10 text-lg leading-relaxed font-medium pt-4">
              Welkom. Een paar korte vragen en je bent er.
            </p>
            <button type="button" onClick={() => setStep('q1')} className="btn-lander max-w-md mx-auto">
              Beginnen
              <ArrowRight className="w-5 h-5" />
            </button>
            <p className="mt-8 text-sm text-gray-600">
              Al een account?{' '}
              <Link href="/login" className="link-lander">
                Inloggen
              </Link>
            </p>
            <p className="mt-4 text-sm text-gray-600 flex items-center justify-center gap-2">
              <span aria-hidden>🕒</span>
              Meedoen duurt maar 1 minuut
            </p>
          </div>
        )}

        {(step === 'q1' || step === 'q2' || step === 'q3') && (
          <div className="w-full space-y-8">
            <p className="text-center text-sm font-semibold text-lander-accent">
              Vraag {qIndex + 1} van {ONBOARDING_VRAAG_TOTAAL}
            </p>
            <h2 className="text-center text-xl md:text-2xl font-semibold text-gray-900 leading-snug px-1">
              {VRAGEN[qIndex]?.tekst}
            </h2>
            <div className="flex flex-col gap-4 pt-2 max-w-md mx-auto w-full">
              <button
                type="button"
                onClick={() => answerJaNee(true)}
                className="btn-lander group justify-between"
              >
                Ja
                <ArrowRight className="w-5 h-5 opacity-90 group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button type="button" onClick={() => answerJaNee(false)} className="btn-lander-outline group">
                Nee
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
            {showVraagVoettekst && (
              <p className="text-center text-sm text-gray-600 flex items-center justify-center gap-2 pt-4">
                <span aria-hidden>🕒</span>
                Meedoen duurt maar 1 minuut
              </p>
            )}
          </div>
        )}

        {step === 'zoekEigenschappen' && (
          <div className="w-full space-y-6 max-w-md mx-auto">
            <p className="text-center text-sm font-semibold text-lander-accent">
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
              <p className="text-sm text-red-700 bg-red-50 rounded-2xl px-4 py-2 border-2 border-red-200">
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
                    className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-all bg-white ${
                      on ? 'option-selected' : 'option-default'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                        on ? 'checkbox-on' : 'border-gray-300 bg-white'
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
                className="btn-lander-outline flex-1 justify-center py-4"
              >
                Terug
              </button>
              <button type="button" onClick={handleEigenschappenNext} className="btn-lander flex-1 py-4">
                Zoeken
              </button>
            </div>
          </div>
        )}

        {step === 'loadingMatches' && (
          <div className="w-full text-center space-y-10">
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
            {matchCount != null && (
              <p className="text-balance text-2xl md:text-3xl font-extrabold leading-tight tracking-tight text-gray-900 px-2">
                Er zijn{' '}
                <span className="text-lander-accent tabular-nums">{matchCount}</span>{' '}
                vrouwen die wachten om benaderd te worden door mannen als jij.
              </p>
            )}
            <a href={CTA_URL} className="btn-lander">
              Bekijk vrouwen
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>
        )}
      </div>

      <footer className="footer-lander py-6 text-center text-xs text-gray-700 px-4">
        18+ · Vertrouwen &amp; discretie
      </footer>
    </div>
  );
}
