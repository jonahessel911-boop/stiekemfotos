'use client';

import React, { useState } from 'react';
import { useAdmin } from '@/components/admin/AdminProvider';

export default function AdminTools() {
  const {
    data,
    resetAnalytics,
    seedTestUser,
    resetBusy,
    seedTestBusy,
    loading,
    passwordEmailNotice,
    setError,
  } = useAdmin();
  const [aiUserId, setAiUserId] = useState('');
  const [aiQuestion, setAiQuestion] = useState('Wat weet je over deze gebruiker?');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 900 }}>
      {passwordEmailNotice ? (
        <div className="admin-alert admin-alert-ok">{passwordEmailNotice}</div>
      ) : null}

      <div className="admin-panel">
        <div className="admin-panel-head">Systeem</div>
        <div style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="admin-btn"
            disabled={seedTestBusy || loading || resetBusy}
            onClick={() => void seedTestUser()}
          >
            {seedTestBusy ? 'Bezig…' : 'Testaccount 10k credits'}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-danger"
            disabled={resetBusy || loading}
            onClick={() => void resetAnalytics()}
          >
            {resetBusy ? 'Resetten…' : 'Reset alle data'}
          </button>
        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-panel-head">AI user intelligence</div>
        <div style={{ padding: 12 }}>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr auto' }}>
            <select
              className="admin-select"
              value={aiUserId}
              onChange={(e) => setAiUserId(e.target.value)}
            >
              <option value="">Selecteer user…</option>
              {(data?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.naam} ({u.email})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={aiLoading || !aiUserId || !aiQuestion.trim()}
              onClick={() => {
                setAiLoading(true);
                setAiError(null);
                setAiAnswer('');
                setError(null);
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
            >
              {aiLoading ? 'AI denkt…' : 'Vraag AI'}
            </button>
          </div>
          <p style={{ margin: '8px 0 4px', fontSize: 11, fontWeight: 'bold' }}>Vraag</p>
          <textarea
            className="admin-textarea"
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
          />
          {aiError ? <div className="admin-alert admin-alert-error">{aiError}</div> : null}
          <p style={{ margin: '10px 0 4px', fontSize: 11, fontWeight: 'bold' }}>Antwoord</p>
          <div
            style={{
              border: '1px solid #b8c5d0',
              background: '#f7fafc',
              padding: 10,
              minHeight: 80,
              whiteSpace: 'pre-wrap',
            }}
          >
            {aiAnswer || 'Nog geen antwoord.'}
          </div>
        </div>
      </div>
    </div>
  );
}
