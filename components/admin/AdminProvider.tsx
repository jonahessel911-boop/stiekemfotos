'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AdminLogin from '@/components/admin/AdminLogin';
import AdminShell from '@/components/admin/AdminShell';
import type { AdminData, PeriodOverview } from '@/lib/admin/types';

type AdminContextValue = {
  loading: boolean;
  error: string | null;
  data: AdminData | null;
  overview: PeriodOverview | null;
  overviewError: string | null;
  passwordEmailNotice: string | null;
  kortingEmailNotice: string | null;
  passwordEmailUserId: string | null;
  kortingEmailUserId: string | null;
  resetBusy: boolean;
  seedTestBusy: boolean;
  load: () => Promise<void>;
  logout: () => Promise<void>;
  sendKortingEmail: (userId: string, userEmail: string, force?: boolean) => Promise<void>;
  sendPasswordEmail: (userId: string, userEmail: string) => Promise<void>;
  resetAnalytics: () => Promise<void>;
  seedTestUser: () => Promise<void>;
  setError: (msg: string | null) => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}

export default function AdminProvider({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [overview, setOverview] = useState<PeriodOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [seedTestBusy, setSeedTestBusy] = useState(false);
  const [passwordEmailUserId, setPasswordEmailUserId] = useState<string | null>(null);
  const [passwordEmailNotice, setPasswordEmailNotice] = useState<string | null>(null);
  const [kortingEmailUserId, setKortingEmailUserId] = useState<string | null>(null);
  const [kortingEmailNotice, setKortingEmailNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOverviewError(null);
    try {
      const [resOverview, resPeriod] = await Promise.all([
        fetch('/api/admin/overview', { credentials: 'include' }),
        fetch('/api/admin/period-overview', { credentials: 'include' }),
      ]);
      if (resOverview.status === 401) {
        setAuthorized(false);
        setData(null);
        setOverview(null);
        return;
      }
      const d = (await resOverview.json()) as AdminData & { error?: string };
      if (!resOverview.ok) throw new Error(d.error || 'Laden mislukt');
      setAuthorized(true);
      setData(d);

      if (resPeriod.ok) {
        setOverview((await resPeriod.json()) as PeriodOverview);
      } else {
        const errBody = (await resPeriod.json().catch(() => ({}))) as { error?: string };
        setOverviewError(errBody.error || 'Periode-overzicht niet geladen');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    setAuthorized(false);
    setData(null);
    setOverview(null);
  }, []);

  const sendKortingEmail = useCallback(
    async (userId: string, userEmail: string, force = false) => {
      if (
        !window.confirm(
          force
            ? `Korting-e-mail opnieuw versturen naar ${userEmail}?`
            : `Korting-e-mail versturen naar ${userEmail}?`
        )
      ) {
        return;
      }
      setKortingEmailUserId(userId);
      setKortingEmailNotice(null);
      setError(null);
      try {
        const r = await fetch('/api/admin/send-korting-email', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, email: userEmail, force }),
        });
        const d = (await r.json()) as { message?: string; error?: string; reason?: string };
        if (!r.ok) {
          if (r.status === 409 && d.reason === 'already_sent') {
            if (window.confirm(`${d.error}\n\nToch opnieuw versturen?`)) {
              await sendKortingEmail(userId, userEmail, true);
              return;
            }
          }
          throw new Error(d.error || 'Versturen mislukt');
        }
        setKortingEmailNotice(d.message ?? `Korting-e-mail verstuurd naar ${userEmail}.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'E-mail versturen mislukt');
      } finally {
        setKortingEmailUserId(null);
      }
    },
    []
  );

  const sendPasswordEmail = useCallback(async (userId: string, userEmail: string) => {
    if (!window.confirm(`Toegangs-e-mail versturen naar ${userEmail}?`)) return;
    setPasswordEmailUserId(userId);
    setPasswordEmailNotice(null);
    setError(null);
    try {
      const r = await fetch('/api/admin/send-password-email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const d = (await r.json()) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.error || 'Versturen mislukt');
      setPasswordEmailNotice(d.message ?? `E-mail verstuurd naar ${userEmail}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'E-mail versturen mislukt');
    } finally {
      setPasswordEmailUserId(null);
    }
  }, []);

  const resetAnalytics = useCallback(async () => {
    if (
      !window.confirm(
        'Weet je zeker dat je ALLE analytics + data wilt resetten?\n\nNiet ongedaan te maken.'
      )
    ) {
      return;
    }
    setResetBusy(true);
    try {
      const r = await fetch('/api/admin/reset', { method: 'POST', credentials: 'include' });
      if (!r.ok) {
        const errBody = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || 'Reset mislukt');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset mislukt');
    } finally {
      setResetBusy(false);
    }
  }, [load]);

  const seedTestUser = useCallback(async () => {
    setSeedTestBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/seed-test-user', { method: 'POST', credentials: 'include' });
      const d = (await r.json()) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.error || 'Seed mislukt');
      setPasswordEmailNotice(d.message ?? 'Testaccount aangemaakt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed mislukt');
    } finally {
      setSeedTestBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value: AdminContextValue = {
    loading,
    error,
    data,
    overview,
    overviewError,
    passwordEmailNotice,
    kortingEmailNotice,
    passwordEmailUserId,
    kortingEmailUserId,
    resetBusy,
    seedTestBusy,
    load,
    logout,
    sendKortingEmail,
    sendPasswordEmail,
    resetAnalytics,
    seedTestUser,
    setError,
  };

  if (!authorized) {
    return (
      <div className="admin-app">
        <AdminLogin
          loading={loading}
          error={error}
          onLogin={async (email, password) => {
            setError(null);
            setLoading(true);
            try {
              const r = await fetch('/api/admin/login', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
              });
              const d = (await r.json()) as { error?: string };
              if (!r.ok) throw new Error(d.error || 'Inloggen mislukt');
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Fout');
            } finally {
              setLoading(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <AdminContext.Provider value={value}>
      <div className="admin-app">
        <AdminShell>{children}</AdminShell>
      </div>
    </AdminContext.Provider>
  );
}
