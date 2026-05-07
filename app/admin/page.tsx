'use client';

import React, { useEffect, useMemo, useState } from 'react';

type AdminData = {
  stats: { users: number; signups: number; purchases: number; conversations: number };
  signups: Array<{ naam: string; email: string; leeftijd: number; createdAt: string }>;
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

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/overview', { credentials: 'include' });
      const d = (await r.json()) as AdminData & { error?: string };
      if (r.status === 401) {
        setAuthorized(false);
        setData(null);
        return;
      }
      if (!r.ok) throw new Error(d.error || 'Laden mislukt');
      setAuthorized(true);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => data?.stats, [data]);

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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Admin portal</h1>
          <div className="flex gap-2">
            <button
              onClick={() => void load()}
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              Vernieuwen
            </button>
            <button
              onClick={() =>
                void fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).then(() => {
                  setAuthorized(false);
                  setData(null);
                })
              }
              className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white"
            >
              Uitloggen
            </button>
          </div>
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Users" value={stats.users} />
            <Stat label="Signups" value={stats.signups} />
            <Stat label="Aankopen" value={stats.purchases} />
            <Stat label="Gesprekken" value={stats.conversations} />
          </div>
        ) : null}

        <Section title="Signups">
          <SimpleTable
            headers={['Naam', 'E-mail', 'Leeftijd', 'Aangemaakt']}
            rows={(data?.signups ?? []).map((s) => [s.naam, s.email, String(s.leeftijd), fmt(s.createdAt)])}
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
    </div>
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
