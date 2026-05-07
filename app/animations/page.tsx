"use client";

import React, { useEffect, useState } from "react";

type Row = { key: string; url: string | null };

async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 220) || "Onverwacht serverantwoord");
  }
}

export default function AnimationsPage() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [giftClosedUrl, setGiftClosedUrl] = useState<string | null>(null);
  const [giftOpenUrl, setGiftOpenUrl] = useState<string | null>(null);
  const [closedFile, setClosedFile] = useState<File | null>(null);
  const [openFile, setOpenFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState<null | "gift_closed" | "gift_open">(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch("/api/admin/overview", { credentials: "include" });
        if (!cancel) {
          setAuthorized(r.ok);
        }
      } catch {
        if (!cancel) setAuthorized(false);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!authorized) return;
    let cancel = false;
    (async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/animations/gift_closed"),
          fetch("/api/animations/gift_open"),
        ]);
        const d1 = await safeJson<Row>(r1);
        const d2 = await safeJson<Row>(r2);
        if (!cancel) {
          setGiftClosedUrl(d1.url ?? null);
          setGiftOpenUrl(d2.url ?? null);
        }
      } catch {
        if (!cancel) {
          setGiftClosedUrl(null);
          setGiftOpenUrl(null);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [authorized]);

  if (loading) {
    return <main className="min-h-screen bg-gray-50 p-6">laden…</main>;
  }

  if (!authorized) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">Animations</h1>
          <p className="mt-1 text-sm text-gray-600">Log eerst in via /admin.</p>
          <a
            href="/admin"
            className="mt-4 inline-flex w-full justify-center rounded-xl bg-black px-3 py-2 font-semibold text-white"
          >
            naar admin
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Animations</h1>
          <a href="/admin" className="text-sm font-semibold text-primary underline">
            terug naar admin
          </a>
        </div>

        {error ? (
          <p className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Cadeau animaties</h2>
            <p className="mt-1 text-sm text-gray-600">
              Je hebt 2 video’s nodig: 1) closed box (loopt en is klikbaar) en 2) open (speelt af na klik).
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900">1) Closed box (klikbaar)</h3>
                <p className="text-sm text-gray-600">Deze staat direct in de chat en loopt in een loop.</p>
              </div>
              {giftClosedUrl ? (
                <video
                  src={giftClosedUrl}
                  className="w-full rounded-2xl border border-gray-200 bg-black/5"
                  muted
                  playsInline
                  loop
                  autoPlay
                  controls
                />
              ) : (
                <p className="text-sm text-gray-500">nog geen closed box ingesteld</p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  onChange={(e) => setClosedFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  disabled={!closedFile || uploading !== null}
                  onClick={() => {
                    if (!closedFile) return;
                    setUploading("gift_closed");
                    setError(null);
                    void (async () => {
                      try {
                        const fd = new FormData();
                        fd.set("key", "gift_closed");
                        fd.set("file", closedFile);
                        const r = await fetch("/api/admin/animations/upload", {
                          method: "POST",
                          credentials: "include",
                          body: fd,
                        });
                        const d = await safeJson<{ url?: string; error?: string; warning?: string }>(r);
                        if (!r.ok) throw new Error(d.error || "upload failed");
                        setGiftClosedUrl(d.url ?? null);
                        if (d.warning) setError(d.warning);
                        setClosedFile(null);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "upload failed");
                      } finally {
                        setUploading(null);
                      }
                    })();
                  }}
                  className="inline-flex justify-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {uploading === "gift_closed" ? "uploading…" : "upload"}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900">2) Open animatie</h3>
                <p className="text-sm text-gray-600">Deze speelt 1× af na klik, daarna tonen we cadeau details.</p>
              </div>
              {giftOpenUrl ? (
                <video
                  src={giftOpenUrl}
                  className="w-full rounded-2xl border border-gray-200 bg-black/5"
                  muted
                  playsInline
                  controls
                />
              ) : (
                <p className="text-sm text-gray-500">nog geen open animatie ingesteld</p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  onChange={(e) => setOpenFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  disabled={!openFile || uploading !== null}
                  onClick={() => {
                    if (!openFile) return;
                    setUploading("gift_open");
                    setError(null);
                    void (async () => {
                      try {
                        const fd = new FormData();
                        fd.set("key", "gift_open");
                        fd.set("file", openFile);
                        const r = await fetch("/api/admin/animations/upload", {
                          method: "POST",
                          credentials: "include",
                          body: fd,
                        });
                        const d = await safeJson<{ url?: string; error?: string; warning?: string }>(r);
                        if (!r.ok) throw new Error(d.error || "upload failed");
                        setGiftOpenUrl(d.url ?? null);
                        if (d.warning) setError(d.warning);
                        setOpenFile(null);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "upload failed");
                      } finally {
                        setUploading(null);
                      }
                    })();
                  }}
                  className="inline-flex justify-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {uploading === "gift_open" ? "uploading…" : "upload"}
                </button>
              </div>
            </div>
          </div>

        </section>
      </div>
    </main>
  );
}

