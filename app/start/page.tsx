'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { CircularLoader } from '@/components/CircularLoader';
import { ArrowRight, Check } from 'lucide-react';
import { setStoredUser } from '@/lib/onboarding-client';

type Step =
  | 'splash'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'q4'
  | 'fotoVoorkeur'
  | 'zoekLeeftijd'
  | 'zoekEigenschappen'
  | 'loadingMatches'
  | 'signupForm'
  | 'akkoord';

/** Vier ja/nee-vragen + foto-voorkeur + leeftijdscategorie + eigenschappen */
const ONBOARDING_VRAAG_TOTAAL = 7;

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
      'Op het platform heb je alleen toegang tot vrouwen die interesse hebben in persoonlijk & fysiek contact. Ben je daar oké mee?',
  },
  {
    id: 'q4',
    tekst:
      'Kun je omgaan met vrouwen die pit hebben? De meeste zijn Oost-Europees.',
  },
];

const LEEFTIJD_CATEGORIEEN = [
  { id: '18-24', label: '18–24 jaar' },
  { id: '25-34', label: '25–34 jaar' },
  { id: '35-44', label: '35–44 jaar' },
  { id: '45-54', label: '45–54 jaar' },
  { id: '55plus', label: '55 jaar en ouder' },
] as const;

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

const FOTO_VOORKEUR_OPTIES = [
  { id: 'naakt', label: 'Naakt' },
  { id: 'lingerie', label: 'Lingerie' },
  { id: 'spiegel-selfies', label: 'Spiegel selfies' },
  { id: 'close-up', label: 'Close-up details' },
] as const;

type Answers = {
  q1: boolean | null;
  q2: boolean | null;
  q3: boolean | null;
  q4: boolean | null;
};

function randomMatchCount(): number {
  return Math.floor(11 + Math.random() * (50 - 11 + 1));
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export default function StartPage() {
  const [step, setStep] = useState<Step>('splash');
  const [answers, setAnswers] = useState<Answers>({
    q1: null,
    q2: null,
    q3: null,
    q4: null,
  });
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [zoekLeeftijdIds, setZoekLeeftijdIds] = useState<Set<string>>(() => new Set());
  const [eigenschapIds, setEigenschapIds] = useState<Set<string>>(() => new Set());
  const [fotoVoorkeurId, setFotoVoorkeurId] = useState<string | null>(null);
  const [maandFotoCount, setMaandFotoCount] = useState<number | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);
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
        const preferenceBonus = Math.min(
          6,
          Math.max(0, zoekLeeftijdIds.size - 1) + Math.max(0, eigenschapIds.size - 1)
        );
        setMatchCount(Math.min(50, base + preferenceBonus));
        setStep('signupForm');
      }
    };
    requestAnimationFrame(tick);
  }, [step]);

  const qIndex =
    step === 'q1'
      ? 0
      : step === 'q2'
        ? 1
        : step === 'q3'
          ? 2
          : step === 'q4'
            ? 3
            : -1;

  const answerJaNee = (ja: boolean) => {
    const keys: (keyof Answers)[] = ['q1', 'q2', 'q3', 'q4'];
    const current = keys[qIndex];
    if (!current) return;
    setAnswers((a) => ({ ...a, [current]: ja }));
    if (qIndex < keys.length - 1) {
      setStep(keys[qIndex + 1] as Step);
    } else {
      setStep('fotoVoorkeur');
    }
  };

  const handleFotoVoorkeurNext = () => {
    setError(null);
    if (!fotoVoorkeurId) {
      setError('Kies minimaal één foto-voorkeur.');
      return;
    }
    const ranges: Record<string, [number, number]> = {
      naakt: [120, 200],
      lingerie: [80, 170],
      'spiegel-selfies': [45, 140],
      'close-up': [70, 180],
    };
    const [min, max] = ranges[fotoVoorkeurId] ?? [30, 200];
    setMaandFotoCount(randomInt(min, max));
    setStep('zoekLeeftijd');
  };

  const toggleEigenschap = (id: string) => {
    setEigenschapIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLeeftijdCategorie = (id: string) => {
    setZoekLeeftijdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  };

  const handleZoekLeeftijdNext = () => {
    setError(null);
    if (zoekLeeftijdIds.size === 0) {
      setError('Kies minimaal één leeftijdscategorie.');
      return;
    }
    setStep('zoekEigenschappen');
  };

  const handleEigenschappenNext = () => {
    setError(null);
    if (eigenschapIds.size === 0) {
      setError('Kies minimaal één eigenschap.');
      return;
    }
    setStep('loadingMatches');
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
    const leeftijdLabels = LEEFTIJD_CATEGORIEEN.filter((c) => zoekLeeftijdIds.has(c.id)).map(
      (c) => c.label
    );
    const categorieLabel = leeftijdLabels.length ? leeftijdLabels.join(', ') : '';
    const eigenschappenLabels = EIGENSCHAP_OPTIES.filter((o) => eigenschapIds.has(o.id)).map(
      (o) => o.label
    );
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
          zoekLeeftijdCategorie: categorieLabel || undefined,
          zoekEigenschappen: eigenschappenLabels.length ? eigenschappenLabels : undefined,
          geschatteMatches: matchCount ?? undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: {
          id: string;
          naam: string;
          email: string;
          leeftijd: number;
          createdAt: string;
        };
        needsEmailVerification?: boolean;
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
      window.location.assign('/profielen');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan mislukt. Probeer opnieuw.');
    } finally {
      setSubmitting(false);
    }
  };

  const showVraagVoettekst =
    step === 'q1' || step === 'q2' || step === 'q3' || step === 'q4';

  const fotoVoorkeurLabel =
    FOTO_VOORKEUR_OPTIES.find((opt) => opt.id === fotoVoorkeurId)?.label.toLowerCase() ?? null;

  const zoekLeeftijdSamenvatting = LEEFTIJD_CATEGORIEEN.filter((c) => zoekLeeftijdIds.has(c.id))
    .map((c) => c.label)
    .join(', ');

  return (
    <div className="min-h-screen bg-[var(--onboarding-bg)] flex flex-col">
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

        {(step === 'q1' || step === 'q2' || step === 'q3' || step === 'q4') && (
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

        {step === 'fotoVoorkeur' && (
          <div className="w-full space-y-6 max-w-md mx-auto">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <p className="text-center text-sm font-semibold text-gray-600">
              Vraag 5 van {ONBOARDING_VRAAG_TOTAAL}
            </p>
            <div>
              <h2 className="text-center text-xl md:text-2xl font-semibold text-gray-900 leading-snug">
                Wat voor foto's vind jij het geilst?
              </h2>
              <p className="text-center text-sm text-gray-600 mt-2">
                Kies de stijl die jij het liefst ziet.
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-2xl px-4 py-2 border-2 border-red-100">
                {error}
              </p>
            )}
            <div className="space-y-2">
              {FOTO_VOORKEUR_OPTIES.map((opt) => {
                const on = fotoVoorkeurId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setFotoVoorkeurId(opt.id)}
                    className={`w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-4 text-left transition-all ${
                      on
                        ? 'border-primary bg-primary/10'
                        : 'border-gray-300 bg-[var(--onboarding-card)] hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
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
                onClick={() => setStep('q4')}
                className="flex-1 py-4 rounded-full border-2 border-gray-300 bg-white font-semibold text-gray-800"
              >
                Terug
              </button>
              <button
                type="button"
                onClick={handleFotoVoorkeurNext}
                className="flex-1 py-4 rounded-full bg-primary text-white font-semibold shadow-md"
              >
                Volgende
              </button>
            </div>
          </div>
        )}

        {step === 'zoekLeeftijd' && (
          <div className="w-full space-y-6 max-w-md mx-auto">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <p className="text-center text-sm font-semibold text-gray-600">
              Vraag 6 van {ONBOARDING_VRAAG_TOTAAL}
            </p>
            <div>
              <h2 className="text-center text-xl md:text-2xl font-semibold text-gray-900 leading-snug">
                In welke leeftijdscategorie zoek je vrouwen?
              </h2>
              <p className="text-center text-sm text-gray-600 mt-2">
                Meerdere antwoorden mogelijk — hoe meer je selecteert, hoe breder je zoekprofiel.
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-2xl px-4 py-2 border-2 border-red-100">
                {error}
              </p>
            )}
            <div className="space-y-2">
              {LEEFTIJD_CATEGORIEEN.map((c) => {
                const on = zoekLeeftijdIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleLeeftijdCategorie(c.id)}
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
                    <span className="font-medium text-gray-900">{c.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('fotoVoorkeur')}
                className="flex-1 py-4 rounded-full border-2 border-gray-300 bg-white font-semibold text-gray-800"
              >
                Terug
              </button>
              <button
                type="button"
                onClick={handleZoekLeeftijdNext}
                className="flex-1 py-4 rounded-full bg-primary text-white font-semibold shadow-md"
              >
                Volgende
              </button>
            </div>
          </div>
        )}

        {step === 'zoekEigenschappen' && (
          <div className="w-full space-y-6 max-w-md mx-auto">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            <p className="text-center text-sm font-semibold text-gray-600">
              Vraag 7 van {ONBOARDING_VRAAG_TOTAAL}
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
                onClick={() => setStep('zoekLeeftijd')}
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
            {zoekLeeftijdSamenvatting ? (
              <p className="text-sm text-gray-600 px-2">
                Leeftijd: {zoekLeeftijdSamenvatting} · {eigenschapIds.size}{' '}
                {eigenschapIds.size === 1 ? 'wens' : 'wensen'} geselecteerd
              </p>
            ) : null}
          </div>
        )}

        {step === 'signupForm' && (
          <div className="w-full space-y-6 max-w-md mx-auto px-1">
            <div className="flex justify-center">
              <Logo variant="hero" className="scale-90" />
            </div>
            {matchCount != null ? (
              <>
                {maandFotoCount != null && fotoVoorkeurLabel ? (
                  <p className="text-center text-sm md:text-base text-gray-700 leading-relaxed px-2">
                    Deze maand zijn er al{' '}
                    <span className="font-bold text-primary tabular-nums">{maandFotoCount}</span>{' '}
                    {fotoVoorkeurLabel} foto's gestuurd door vrouwen op het platform.
                  </p>
                ) : null}
                <p className="text-center text-lg md:text-xl text-gray-900 leading-relaxed font-medium px-2">
                  We hebben{' '}
                  <span className="text-primary font-bold tabular-nums text-2xl md:text-3xl">
                    {matchCount}
                  </span>{' '}
                  vrouwen gevonden die bij je wensen passen.
                </p>
                <p className="text-center text-sm text-gray-600">
                  Maak hieronder een account om verder te gaan.
                </p>
              </>
            ) : (
              <p className="text-center text-sm text-gray-600">
                Vul je gegevens in om een account aan te maken.
              </p>
            )}
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
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--onboarding-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
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
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--onboarding-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
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
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--onboarding-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
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
                  className="mt-1.5 w-full rounded-2xl border-2 border-gray-300 bg-[var(--onboarding-card)] px-4 py-4 text-[16px] shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                  placeholder="Minimaal 8 tekens"
                  autoComplete="new-password"
                />
              </label>
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-3 py-5 px-8 rounded-full bg-primary text-white font-semibold text-lg shadow-lg shadow-primary/30 hover:bg-primary-hover transition-all"
              >
                Bekijk vrouwen
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
            <label className="flex gap-3 items-start cursor-pointer rounded-2xl bg-[var(--onboarding-card)] p-4 border-2 border-gray-300 shadow-sm">
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
            <label className="flex gap-3 items-start cursor-pointer rounded-2xl bg-[var(--onboarding-card)] p-4 border-2 border-gray-300 shadow-sm">
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

      <footer className="py-6 text-center text-xs text-gray-600 px-4 border-t border-primary/15 bg-[var(--onboarding-footer-bg)]">
        stiekemefotos.nl · 18+ · Vertrouwen &amp; discretie
      </footer>
    </div>
  );
}
