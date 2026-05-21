'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clearStoredUser, setStoredUser } from '@/lib/onboarding-client';

type SessionUser = { id: string; naam: string; email: string };

type Props = {
  children: React.ReactNode;
};

function platform2NavActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/platform/2/profielen') return pathname.startsWith('/platform/2/profielen');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Platform2Chrome({ children }: Props) {
  const pathname = usePathname();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const data = (await res.json()) as {
          user?: { id: string; naam: string; email: string; leeftijd: number };
        };
        if (!cancel && data.user?.id) {
          setSessionUser({
            id: data.user.id,
            naam: data.user.naam,
            email: data.user.email,
          });
        }
      } finally {
        if (!cancel) setAuthChecked(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const headerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErr(null);
    setLoginBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: loginEmail.trim().toLowerCase(),
          password: loginPass,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        user?: { id: string; naam: string; email: string; leeftijd: number; createdAt: string };
      };
      if (!res.ok) throw new Error(data.error || 'Inloggen mislukt');
      if (!data.user) throw new Error('Inloggen mislukt');
      setStoredUser({
        id: data.user.id,
        naam: data.user.naam,
        email: data.user.email,
        leeftijd: data.user.leeftijd,
        discreetAkkoord: true,
        voorwaardenAkkoord: true,
        completedAt: data.user.createdAt,
      });
      setSessionUser({
        id: data.user.id,
        naam: data.user.naam,
        email: data.user.email,
      });
      window.location.href = '/platform/2/profielen';
    } catch (err) {
      setLoginErr(err instanceof Error ? err.message : 'Fout');
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = async () => {
    setLogoutBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      clearStoredUser();
      setSessionUser(null);
      window.location.href = '/platform/2/aanmaken';
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <div className="platform2-root">
      <div className="platform2-wrap">
        <header className="platform2-header">
          <Link href="/platform/2/aanmaken" className="platform2-logo">
            <span>Stiekem</span>
            <em>fotos</em> <small>.nl</small>
          </Link>
          {authChecked && sessionUser ? (
            <div className="platform2-user-bar">
              <span>
                Hallo, <b>{sessionUser.naam}</b>
              </span>
              <button
                type="button"
                className="platform2-btn platform2-btn-muted"
                onClick={() => void logout()}
                disabled={logoutBusy}
              >
                {logoutBusy ? '…' : 'Uitloggen'}
              </button>
            </div>
          ) : authChecked ? (
            <form className="platform2-login" onSubmit={headerLogin}>
              <input
                type="text"
                placeholder="Naam/E-mail"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="username"
              />
              <input
                type="password"
                placeholder="Wachtwoord"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                autoComplete="current-password"
              />
              <button type="submit" className="platform2-btn" disabled={loginBusy}>
                {loginBusy ? '…' : 'Inloggen'}
              </button>
              {loginErr ? (
                <span className="platform2-login-error">{loginErr}</span>
              ) : null}
            </form>
          ) : (
            <div className="platform2-user-bar platform2-user-bar--loading">…</div>
          )}
        </header>

        {authChecked && sessionUser ? (
          <nav className="platform2-nav" aria-label="Hoofdmenu">
            <Link
              href="/platform/2/profielen"
              className={platform2NavActive(pathname, '/platform/2/profielen') ? 'is-active' : undefined}
            >
              Zoek profielen
            </Link>
            <Link
              href="/platform/2/berichten"
              className={platform2NavActive(pathname, '/platform/2/berichten') ? 'is-active' : undefined}
            >
              Berichten
            </Link>
            <Link
              href="/platform/2/mijn-profiel"
              className={platform2NavActive(pathname, '/platform/2/mijn-profiel') ? 'is-active' : undefined}
            >
              Mijn profiel
            </Link>
            <Link
              href="/platform/2/credits"
              className={platform2NavActive(pathname, '/platform/2/credits') ? 'is-active' : undefined}
            >
              Credits kopen
            </Link>
          </nav>
        ) : null}

        {children}

        <footer className="platform2-footer">
          <div className="platform2-footer-links">
            <a href="#">Over ons</a>
            <a href="#">Prijs</a>
            <a href="#">Privacy</a>
            <a href="#">Voorwaarden</a>
            <a href="#">FAQ</a>
            <a href="#">Helpdesk</a>
          </div>
          <p>© {new Date().getFullYear()} — platform variant 2</p>
          <p style={{ marginTop: 8, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
            Fictieve profielen. 18+. Discreet contactplatform.
          </p>
        </footer>
      </div>
    </div>
  );
}
