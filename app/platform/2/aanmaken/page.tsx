'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import Platform2Chrome from '@/components/platform2/Platform2Chrome';
import { setStoredUser } from '@/lib/onboarding-client';

const ZOEK_OPTIES = [
  { value: 'vrouw', label: 'een man die een vrouw zoekt' },
  { value: 'man', label: 'een vrouw die een man zoekt' },
] as const;

export default function Platform2AanmakenPage() {
  const [naam, setNaam] = useState('');
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [leeftijd, setLeeftijd] = useState('');
  const [zoekt, setZoekt] = useState<(typeof ZOEK_OPTIES)[number]['value']>('vrouw');
  const [akkoord, setAkkoord] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const age = parseInt(leeftijd, 10);
    if (!naam.trim() || !email.trim() || !leeftijd.trim()) {
      setError('Vul alle velden in.');
      return;
    }
    if (!Number.isFinite(age) || age < 18) {
      setError('Vul een geldige leeftijd in (minimaal 18).');
      return;
    }
    if (wachtwoord.length < 8) {
      setError('Wachtwoord: minimaal 8 tekens.');
      return;
    }
    if (!akkoord) {
      setError('Vink het vakje aan om door te gaan.');
      return;
    }
    setBusy(true);
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
          discreetAkkoord: true,
          voorwaardenAkkoord: true,
          zoekEigenschappen: [`zoekt_${zoekt}`],
          source: 'platform2',
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: { id: string; naam: string; email: string; leeftijd: number; createdAt: string };
      };
      if (!res.ok) throw new Error(data.error || 'Aanmelden mislukt');
      if (!data.user) throw new Error('Aanmelden mislukt');
      setStoredUser({
        id: data.user.id,
        naam: data.user.naam,
        email: data.user.email,
        leeftijd: data.user.leeftijd,
        discreetAkkoord: true,
        voorwaardenAkkoord: true,
        completedAt: data.user.createdAt,
      });
      window.location.href = '/platform/2/profielen';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Platform2Chrome>
      <div className="platform2-signup-hero">
        <div className="platform2-signup-visual platform2-signup-visual--desktop">
          <Image
            src="/platform/2/hero-ontmoet.png"
            alt="Vrouw die contact legt via haar telefoon"
            width={520}
            height={390}
            className="platform2-signup-image"
            priority
          />
          <p className="platform2-signup-tagline">Ontmoet jongere mannen die willen afspreken</p>
        </div>
        <div className="platform2-signup-form-wrap">
          <p className="platform2-signup-tagline-mobile">Ontmoet jongere mannen die willen afspreken</p>
          <h2>Meld je NU aan!</h2>
          {error ? <div className="platform2-error">{error}</div> : null}
          <form className="platform2-form" onSubmit={submit}>
            <label>
              <b>Gebruikersnaam</b>
              <input
                type="text"
                required
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                maxLength={40}
              />
            </label>
            <label>
              <b>Ik ben</b>
              <select value={zoekt} onChange={(e) => setZoekt(e.target.value as typeof zoekt)}>
                {ZOEK_OPTIES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <b>Leeftijd</b>
              <input
                type="number"
                min={18}
                max={99}
                required
                placeholder="Leeftijd"
                value={leeftijd}
                onChange={(e) => setLeeftijd(e.target.value)}
              />
            </label>
            <label>
              <b>Mijn e-mail</b>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              <b>Wachtwoord</b>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={wachtwoord}
                onChange={(e) => setWachtwoord(e.target.value)}
              />
            </label>
            <label className="platform2-checkbox">
              <input
                type="checkbox"
                checked={akkoord}
                onChange={(e) => setAkkoord(e.target.checked)}
              />
              <span>
                Ik ga akkoord met de voorwaarden en ben 18+. Ik begrijp dat dit een discreet
                contactplatform is.
              </span>
            </label>
            <button type="submit" className="platform2-btn platform2-btn-lg platform2-btn-block" disabled={busy}>
              {busy ? 'Bezig…' : 'NU GRATIS AANMELDEN'}
            </button>
          </form>
          <p className="platform2-signup-login-hint">
            <Link href="/platform/2/aanmelden">Ik heb al een account</Link>
          </p>
        </div>
      </div>
    </Platform2Chrome>
  );
}
