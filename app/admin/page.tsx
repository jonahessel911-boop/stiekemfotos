'use client';

import React, { useEffect, useState } from 'react';

type DailyBucket = { date: string; value: number };

type AdminAnalytics = {
  uniqueChatConversations: number;
  totalLockedImagesSent: number;
  totalUserImagesSent: number;
  totalImagesUnlocked: number;
  unlockConversionPercent: number | null;
  firstUserMessageToFirstLockedImagePercent: number | null;
  firstUnlockToSecondUnlockPercent: number | null;
  revenueEurTotal: number;
  totalCreditsPurchased: number;
  revenueByDay: DailyBucket[];
  purchasesByDay: DailyBucket[];
  signupsByDay: DailyBucket[];
  chartDays: number;
};

type PeriodRow = {
  key: string;
  label: string;
  signups: number;
  conversions: number;
  revenueEur: number;
  signupToUserChatPct: number | null;
  userChatToUnlockFreePct: number | null;
  userChatToUnlockPaidPct: number | null;
  signupToPaidPct: number | null;
  reSignPct: number | null;
  used100CreditsPct: number | null;
  usedFreeCreditsPct: number | null;
};

type PeriodOverview = {
  periods: PeriodRow[];
  totals: PeriodRow;
};

type AdminData = {
  stats: { users: number; signups: number; purchases: number; conversations: number };
  analytics?: AdminAnalytics;
  signups: Array<{
    naam: string;
    email: string;
    leeftijd: number;
    createdAt: string;
    creditsSpent?: number;
  }>;
  users: Array<{
    id: string;
    email: string;
    naam: string;
    leeftijd: number;
    createdAt: string;
    emailVerified: boolean;
    conversations: number;
    userMessages: number;
    purchasesCount: number;
    purchasedCredits: number;
  }>;
  purchases: Array<{
    sessionId: string;
    userId: string;
    userEmail: string;
    credits: number;
    priceLabel: string;
    paidAt: string;
    fulfilledAt: string;
  }>;
  conversationsByUser: Array<{
    userId: string;
    userEmail: string;
    userName: string;
    conversations: Array<{
      id: string;
      profileName: string;
      updatedAt: string;
      messages: number;
      lastMessage: string;
      history: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        createdAt: string;
      }>;
    }>;
  }>;
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('nl-NL');
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [aiUserId, setAiUserId] = useState('');
  const [aiQuestion, setAiQuestion] = useState('Wat weet je over deze gebruiker?');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [overview, setOverview] = useState<PeriodOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const load = async () => {
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
        const po = (await resPeriod.json()) as PeriodOverview;
        setOverview(po);
      } else {
        const errBody = (await resPeriod.json().catch(() => ({}))) as { error?: string };
        setOverviewError(errBody.error || 'Periode-overzicht niet geladen');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout');
    } finally {
      setLoading(false);
    }
  };

  const resetAnalytics = async () => {
    if (
      !window.confirm(
        'Weet je zeker dat je ALLE analytics + data wilt resetten?\n\nDit wist users, signups, conversations, messages en aankopen — zowel uit blob-opslag als Supabase. Niet ongedaan te maken.'
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
  };

  useEffect(() => {
    void load();
  }, []);

  if (!authorized) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Admin login</h1>
          <p className="mt-1 text-sm text-gray-600">Alleen bereikbaar via /admin</p>
          {error ? (
            <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              setLoading(true);
              void (async () => {
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
              })();
            }}
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2"
              placeholder="E-mail"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2"
              placeholder="Wachtwoord"
            />
            <button
              disabled={loading}
              className="w-full rounded-xl bg-black px-3 py-2 font-semibold text-white disabled:opacity-60"
              type="submit"
            >
              {loading ? 'Laden…' : 'Inloggen'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin portal</h1>
            <p className="text-xs text-gray-500">Periode-overzicht (per maand)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void load()}
              disabled={loading || resetBusy}
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {loading ? 'Laden…' : 'Vernieuwen'}
            </button>
            <button
              onClick={() => void resetAnalytics()}
              disabled={resetBusy || loading}
              className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
              title="Wis alle users, signups, conversations en aankopen (Supabase + blob)"
            >
              {resetBusy ? 'Resetten…' : 'Reset analytics'}
            </button>
            <button
              onClick={() =>
                void fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).then(() => {
                  setAuthorized(false);
                  setData(null);
                  setOverview(null);
                })
              }
              className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white"
            >
              Uitloggen
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <PeriodOverviewTable
          overview={overview}
          overviewError={overviewError}
          loading={loading}
        />

        <Section title="Signups">
          <SimpleTable
            headers={['Naam', 'E-mail', 'Leeftijd', 'Credits gebruikt', 'Aangemaakt']}
            rows={(data?.signups ?? []).map((s) => [
              s.naam,
              s.email,
              String(s.leeftijd),
              String(s.creditsSpent ?? 0),
              fmt(s.createdAt),
            ])}
          />
        </Section>

        <Section title="Aankopen">
          <SimpleTable
            headers={['User e-mail', 'Credits', 'Prijs', 'Betaald op', 'Fulfilled']}
            rows={(data?.purchases ?? []).map((p) => [
              p.userEmail,
              String(p.credits),
              p.priceLabel,
              fmt(p.paidAt),
              p.fulfilledAt ? fmt(p.fulfilledAt) : 'nee',
            ])}
          />
        </Section>

        <Section title="Users">
          <SimpleTable
            headers={[
              'Naam',
              'E-mail',
              'Leeftijd',
              'E-mail geverifieerd',
              'Conversations',
              'User berichten',
              'Aankopen',
              'Credits gekocht',
            ]}
            rows={(data?.users ?? []).map((u) => [
              u.naam,
              u.email,
              String(u.leeftijd),
              u.emailVerified ? 'ja' : 'nee',
              String(u.conversations),
              String(u.userMessages),
              String(u.purchasesCount),
              String(u.purchasedCredits),
            ])}
          />
        </Section>

        <Section title="AI user intelligence">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={aiUserId}
                onChange={(e) => setAiUserId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Selecteer user…</option>
                {(data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.naam} ({u.email})
                  </option>
                ))}
              </select>
              <button
                disabled={aiLoading || !aiUserId || !aiQuestion.trim()}
                onClick={() => {
                  setAiLoading(true);
                  setAiError(null);
                  setAiAnswer('');
                  void (async () => {
                    try {
                      const r = await fetch('/api/admin/ai-user-intel', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: aiUserId, question: aiQuestion }),
                      });
                      const d = (await r.json()) as { answer?: string; error?: string };
                      if (!r.ok) throw new Error(d.error || 'AI request mislukt');
                      setAiAnswer(d.answer ?? '');
                    } catch (e) {
                      setAiError(e instanceof Error ? e.message : 'Fout');
                    } finally {
                      setAiLoading(false);
                    }
                  })();
                }}
                className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                type="button"
              >
                {aiLoading ? 'AI denkt…' : 'Vraag AI'}
              </button>
            </div>
            <textarea
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              className="min-h-24 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
              placeholder="Bijv: heeft hij kinderen, relatie en wat doet hij voor werk?"
            />
            {aiError ? (
              <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                {aiError}
              </p>
            ) : null}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">AI antwoord</p>
              <p className="whitespace-pre-wrap text-sm text-gray-800">
                {aiAnswer || 'Nog geen antwoord.'}
              </p>
            </div>
          </div>
        </Section>

        <Section title="Gesprekken per user">
          <div className="space-y-3">
            {(data?.conversationsByUser ?? []).map((u) => (
              <details key={u.userId} className="rounded-xl border border-gray-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-900">
                  {u.userName} ({u.userEmail}) · {u.conversations.length} gesprekken
                </summary>
                <div className="border-t border-gray-100 p-3">
                  <div className="space-y-3">
                    {u.conversations.map((c) => (
                      <details key={c.id} className="rounded-lg border border-gray-200 bg-gray-50">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-900">
                          {c.profileName} · {c.messages} berichten · {fmt(c.updatedAt)}
                        </summary>
                        <div className="space-y-2 border-t border-gray-200 bg-white p-3">
                          {c.history.length === 0 ? (
                            <p className="text-xs text-gray-500">Geen berichten</p>
                          ) : (
                            c.history.map((m) => (
                              <div
                                key={m.id}
                                className={`rounded-lg px-3 py-2 text-sm ${
                                  m.role === 'user'
                                    ? 'bg-primary/10 text-gray-900'
                                    : 'bg-gray-100 text-gray-800'
                                }`}
                              >
                                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                                  <span>{m.role === 'user' ? 'User' : 'Assistant'}</span>
                                  <span>{fmt(m.createdAt)}</span>
                                </div>
                                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-bold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function formatEur(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%`;
}

function PeriodOverviewTable({
  overview,
  overviewError,
  loading,
}: {
  overview: PeriodOverview | null;
  overviewError: string | null;
  loading: boolean;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Periode-overzicht</h2>
          <p className="text-xs text-gray-500">
            Per maand: omzet, signups en conversies door de funnel.
          </p>
        </div>
        {overview ? (
          <div className="flex flex-wrap gap-4 text-right text-xs text-gray-500">
            <div>
              <div className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">
                Totaal omzet
              </div>
              <div className="text-base font-bold tabular-nums text-gray-900">
                € {formatEur(overview.totals.revenueEur)}
              </div>
            </div>
            <div>
              <div className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">
                Totaal signups
              </div>
              <div className="text-base font-bold tabular-nums text-gray-900">
                {overview.totals.signups}
              </div>
            </div>
            <div>
              <div className="font-semibold uppercase tracking-wide text-[10px] text-gray-400">
                Signup → betaald
              </div>
              <div className="text-base font-bold tabular-nums text-gray-900">
                {formatPct(overview.totals.signupToPaidPct)}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {overviewError ? (
        <div className="px-5 py-3 text-sm text-red-700">{overviewError}</div>
      ) : null}

      <div className="max-h-[640px] overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 text-gray-600">
            <tr>
              <th className="border-b border-gray-200 px-4 py-3 text-left font-semibold">
                Maand
              </th>
              <th className="border-b border-gray-200 px-4 py-3 text-right font-semibold">
                Omzet
              </th>
              <th className="border-b border-gray-200 px-4 py-3 text-right font-semibold">
                Signups
              </th>
              <th className="border-b border-gray-200 px-4 py-3 text-right font-semibold">
                Aankopen
              </th>
              <th
                className="border-b border-gray-200 px-4 py-3 text-right font-semibold"
                title="Van signups in deze maand: % dat ≥1 user-bericht heeft gestuurd"
              >
                Signup → Chat
              </th>
              <th
                className="border-b border-gray-200 px-4 py-3 text-right font-semibold"
                title="Van users-met-chat: % dat een foto unlockte vóór hun eerste betaalde aankoop"
              >
                Chat → Unlock (Free)
              </th>
              <th
                className="border-b border-gray-200 px-4 py-3 text-right font-semibold"
                title="Van users-met-chat: % dat een foto unlockte ná hun eerste betaalde aankoop"
              >
                Chat → Unlock (Paid)
              </th>
              <th
                className="border-b border-gray-200 px-4 py-3 text-right font-semibold"
                title="Van signups in deze maand: % dat een betaalde aankoop heeft gedaan"
              >
                Signup → Paid
              </th>
              <th
                className="border-b border-gray-200 px-4 py-3 text-right font-semibold"
                title="Van signups in deze maand: % dat ten minste 1× is teruggekeerd (users.last_seen_at is gevuld)"
              >
                Re-sign
              </th>
              <th
                className="border-b border-gray-200 px-4 py-3 text-right font-semibold"
                title="Van signups in deze maand: % dat ≥1 foto heeft ontgrendeld (= minimaal 100 credits opgemaakt)"
              >
                100 credits used
              </th>
              <th
                className="border-b border-gray-200 px-4 py-3 text-right font-semibold"
                title="Van signups in deze maand: % dat ≥3 foto's heeft ontgrendeld (300 credits aan foto-unlocks)"
              >
                300 credits used
              </th>
            </tr>
          </thead>
          <tbody>
            {overview && overview.periods.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm text-gray-500">
                  {loading ? 'Laden…' : 'Nog geen data.'}
                </td>
              </tr>
            ) : null}
            {(overview?.periods ?? []).map((row, idx) => (
              <tr
                key={row.key}
                className={`${
                  idx === 0 ? 'bg-amber-50/40' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                } hover:bg-amber-50`}
              >
                <td className="border-b border-gray-100 px-4 py-3 font-semibold text-gray-900">
                  {row.label}
                  {idx === 0 ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                      Huidig
                    </span>
                  ) : null}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-900">
                  € {formatEur(row.revenueEur)}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {row.signups}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {row.conversions}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatPct(row.signupToUserChatPct)}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatPct(row.userChatToUnlockFreePct)}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatPct(row.userChatToUnlockPaidPct)}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums font-semibold text-gray-900">
                  {formatPct(row.signupToPaidPct)}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatPct(row.reSignPct)}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatPct(row.used100CreditsPct)}
                </td>
                <td className="border-b border-gray-100 px-4 py-3 text-right tabular-nums text-gray-700">
                  {formatPct(row.usedFreeCreditsPct)}
                </td>
              </tr>
            ))}
            {overview ? (
              <tr className="bg-gray-900 text-gray-50">
                <td className="px-4 py-3 font-bold">Totaal</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold">
                  € {formatEur(overview.totals.revenueEur)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {overview.totals.signups}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {overview.totals.conversions}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatPct(overview.totals.signupToUserChatPct)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatPct(overview.totals.userChatToUnlockFreePct)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatPct(overview.totals.userChatToUnlockPaidPct)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-bold">
                  {formatPct(overview.totals.signupToPaidPct)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatPct(overview.totals.reSignPct)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatPct(overview.totals.used100CreditsPct)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatPct(overview.totals.usedFreeCreditsPct)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            {headers.map((h) => (
              <th key={h} className="border-b border-gray-200 px-3 py-2 font-semibold text-gray-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-3 py-4 text-center text-gray-500">
                Geen data
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50/40">
                {r.map((c, idx) => (
                  <td key={idx} className="border-b border-gray-100 px-3 py-2 text-gray-700">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
