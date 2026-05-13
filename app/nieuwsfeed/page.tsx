'use client';

import React, { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { MessageCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WelcomeHouseRulesModal } from '@/components/WelcomeHouseRulesModal';
import type { PhotoRequest } from '@/lib/types/photo-request';
import { resolveProfileImageUrl } from '@/lib/profile-image-url';

const PHOTO_TYPE_OPTIONS = [
  { id: 'naakt' as const, label: 'Naakt foto' },
  { id: 'lingerie' as const, label: 'Lingerie' },
  { id: 'casual' as const, label: 'Casual' },
];

const WANTED_WHEN_OPTIONS = [
  { id: 'vandaag' as const, label: 'Vandaag' },
  { id: 'morgen' as const, label: 'Morgen' },
  { id: 'binnen_1_week' as const, label: 'Binnen 1 week' },
];

export default function NieuwsfeedPage() {
  const [requests, setRequests] = useState<PhotoRequest[]>([]);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestStep, setRequestStep] = useState(1);
  const [requestPhotoCategory, setRequestPhotoCategory] = useState<'naakt' | 'lingerie' | 'casual' | ''>('');
  const [requestDescription, setRequestDescription] = useState('');
  const [requestWantedWhen, setRequestWantedWhen] = useState<'vandaag' | 'morgen' | 'binnen_1_week' | ''>(
    'vandaag'
  );
  const [requestMaxCredits, setRequestMaxCredits] = useState('35');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [commentDraftByRequestId, setCommentDraftByRequestId] = useState<Record<string, string>>({});
  const [commentBusyByRequestId, setCommentBusyByRequestId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/photo-requests', { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as { requests?: PhotoRequest[] };
        if (!cancel && Array.isArray(data.requests)) {
          setRequests(data.requests);
        }
      } catch {
        // ignore if user not logged in
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  async function handleCreatePhotoRequest() {
    setRequestError(null);
    const description = requestDescription.trim();
    const maxCredits = Number(requestMaxCredits);
    if (!description || !requestPhotoCategory || !requestWantedWhen) {
      setRequestError('Vul alle stappen in.');
      return;
    }
    const selectedType = PHOTO_TYPE_OPTIONS.find((o) => o.id === requestPhotoCategory)?.label ?? 'Foto';
    setRequestBusy(true);
    try {
      const res = await fetch('/api/photo-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          photoType: selectedType,
          photoCategory: requestPhotoCategory,
          wantedWhen: requestWantedWhen,
          maxCredits,
        }),
      });
      const data = (await res.json()) as { request?: PhotoRequest; error?: string };
      if (!res.ok || !data.request) {
        throw new Error(data.error || 'Aanvraag maken mislukt');
      }
      setRequests((prev) => [data.request!, ...prev]);
      setRequestDescription('');
      setRequestPhotoCategory('');
      setRequestWantedWhen('vandaag');
      setRequestMaxCredits('35');
      setRequestStep(1);
      setShowRequestForm(false);
    } catch (e) {
      setRequestError(e instanceof Error ? e.message : 'Aanvraag maken mislukt');
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleComment(requestId: string) {
    const text = (commentDraftByRequestId[requestId] ?? '').trim();
    if (!text) return;
    setCommentBusyByRequestId((s) => ({ ...s, [requestId]: true }));
    try {
      const res = await fetch(`/api/photo-requests/${requestId}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as { request?: PhotoRequest; error?: string };
      if (!res.ok || !data.request) {
        throw new Error(data.error || 'Reageren mislukt');
      }
      setRequests((prev) => prev.map((r) => (r.id === requestId ? data.request! : r)));
      setCommentDraftByRequestId((s) => ({ ...s, [requestId]: '' }));
    } catch {
      // no-op: keep UX minimal
    } finally {
      setCommentBusyByRequestId((s) => ({ ...s, [requestId]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-24 lg:pb-10">
      <WelcomeHouseRulesModal />
      <Navbar />

      <div className="mx-auto w-full max-w-screen-xl px-4 pt-12 sm:px-6 sm:pt-14 lg:px-8 lg:pt-20">
        <div className="sticky top-12 z-30 mb-6 border-b border-gray-200 bg-[var(--surface)] py-2 sm:top-14 lg:top-20">
          <p className="px-2 text-xl font-bold text-gray-900">Verzoeken</p>
          <p className="px-2 text-sm text-gray-600">Alle foto-verzoeken van gebruikers op het platform.</p>
        </div>

        <div className="mx-auto w-full max-w-3xl space-y-5">
          <section className="rounded-3xl border border-orange-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Foto-verzoeken</h2>
                <p className="text-sm text-gray-600">
                  In 1 dag ontvang je vaak meerdere reacties.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => {
                  setShowRequestForm((s) => !s);
                  setRequestStep(1);
                  setRequestError(null);
                }}
                className="rounded-2xl"
              >
                Nieuw verzoek
              </Button>
            </div>
            {showRequestForm && (
              <div className="mt-4 grid gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Stap {requestStep} van 3
                </p>

                {requestStep === 1 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-800">Kies type foto</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {PHOTO_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setRequestPhotoCategory(opt.id)}
                          className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                            requestPhotoCategory === opt.id
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-gray-200 bg-white text-gray-700'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {requestStep === 2 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-800">
                      Beschrijving (hoe gedetailleerder hoe beter)
                    </p>
                    <textarea
                      value={requestDescription}
                      onChange={(e) => setRequestDescription(e.target.value)}
                      placeholder="Beschrijf precies wat je wilt: pose, setting, hoek, stijl..."
                      className="min-h-[110px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}

                {requestStep === 3 ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-800">Hoeveel credits wil je betalen?</p>
                      <input
                        type="number"
                        min={5}
                        max={500}
                        value={requestMaxCredits}
                        onChange={(e) => setRequestMaxCredits(e.target.value)}
                        placeholder="Max credits"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-800">Wanneer wil je de foto?</p>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {WANTED_WHEN_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setRequestWantedWhen(opt.id)}
                            className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                              requestWantedWhen === opt.id
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-gray-200 bg-white text-gray-700'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {requestError ? <p className="text-sm text-red-600">{requestError}</p> : null}
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRequestStep((s) => Math.max(1, s - 1))}
                    disabled={requestStep === 1 || requestBusy}
                    className="rounded-xl"
                  >
                    Vorige
                  </Button>
                  {requestStep < 3 ? (
                    <Button
                      type="button"
                      onClick={() => {
                        if (requestStep === 1 && !requestPhotoCategory) {
                          setRequestError('Kies eerst een type foto.');
                          return;
                        }
                        if (requestStep === 2 && !requestDescription.trim()) {
                          setRequestError('Vul een beschrijving in.');
                          return;
                        }
                        setRequestError(null);
                        setRequestStep((s) => Math.min(3, s + 1));
                      }}
                      className="rounded-xl"
                    >
                      Volgende
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={requestBusy}
                      onClick={() => void handleCreatePhotoRequest()}
                      className="rounded-xl"
                    >
                      {requestBusy ? 'Bezig...' : 'Plaats aanvraag'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </section>

          {requests.map((r) => (
            <article key={r.id} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Aanvraag • {r.photoType}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(r.createdAt).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                  Max {r.maxCredits} credits
                </span>
              </div>

              <div className="px-4 py-4">
                <p className="text-base leading-relaxed text-gray-800">{r.description}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.photoCategory ? (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                      Type: {PHOTO_TYPE_OPTIONS.find((o) => o.id === r.photoCategory)?.label ?? r.photoType}
                    </span>
                  ) : null}
                  {r.wantedWhen ? (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                      Gewenst: {WANTED_WHEN_OPTIONS.find((o) => o.id === r.wantedWhen)?.label ?? r.wantedWhen}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-center gap-4 border-t border-gray-100 pt-3 text-sm text-gray-600">
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle className="h-4 w-4" />
                    {r.comments.length} reacties
                  </span>
                </div>

                <div className="mt-4 space-y-3 border-t border-gray-100 pt-3">
                  {r.comments.length === 0 ? (
                    <p className="text-sm text-gray-500">Nog geen reacties.</p>
                  ) : (
                    r.comments.map((c) => {
                      const imageUrl =
                        c.authorType === 'profile' ? resolveProfileImageUrl(c.profileAvatar) : '';
                      return (
                      <div key={c.id} className="flex items-start gap-2">
                        {c.authorType === 'profile' ? (
                          <img
                            src={imageUrl}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700">
                            {(c.userName ?? 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                        <p className="text-sm text-gray-700">
                          <span className="font-semibold text-gray-900">
                            {c.authorType === 'profile' ? c.profileName : c.userName}
                          </span>{' '}
                          {c.text}
                        </p>
                      </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <input
                    value={commentDraftByRequestId[r.id] ?? ''}
                    onChange={(e) =>
                      setCommentDraftByRequestId((s) => ({ ...s, [r.id]: e.target.value }))
                    }
                    placeholder="Plaats een reactie..."
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  />
                  <Button
                    type="button"
                    disabled={commentBusyByRequestId[r.id] === true}
                    onClick={() => void handleComment(r.id)}
                    className="rounded-xl px-3"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
