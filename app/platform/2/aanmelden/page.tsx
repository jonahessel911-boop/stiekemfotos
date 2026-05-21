'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Platform2Chrome from '@/components/platform2/Platform2Chrome';
import { setStoredUser } from '@/lib/onboarding-client';

export default function Platform2AanmeldenPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      };
      if (!res.ok) throw new Error(data.error || 'Inloggen mislukt');
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
      window.location.href = '/platform/2/profielen';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Platform2Chrome>
      <div style={{ maxWidth: 360, margin: '20px auto', border: '1px solid #c8c8c8', padding: 16, background: '#fafafa' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Inloggen</h2>
        {error ? <div className="platform2-error">{error}</div> : null}
        <form className="platform2-form" onSubmit={submit}>
          <label>
            <b>E-mail</b>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            <b>Wachtwoord</b>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="platform2-btn platform2-btn-block" disabled={busy}>
            {busy ? 'Bezig…' : 'Inloggen'}
          </button>
        </form>
        <p style={{ marginTop: 12, fontSize: 12 }}>
          <Link href="/wachtwoord-vergeten">Wachtwoord vergeten?</Link>
          <br />
          <Link href="/platform/2/aanmaken">Nog geen account? Meld je aan</Link>
        </p>
      </div>
    </Platform2Chrome>
  );
}
