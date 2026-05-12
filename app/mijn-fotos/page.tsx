'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';

type PurchasedPhotoItem = {
  conversationId: string;
  messageId: string;
  createdAt: string;
  unlockedAt: string;
  profileId: string;
  profileName: string;
  /** Persistent Supabase Storage URL als beschikbaar (anders proxy-route fallback). */
  imageUrl?: string;
};

function photoSrc(it: PurchasedPhotoItem): string {
  return (
    it.imageUrl?.trim() ||
    `/api/conversations/${it.conversationId}/image/${it.messageId}`
  );
}

type ViewMode = 'all' | 'profiles' | 'folders';
type FolderMap = Record<string, string>;

const FOLDERS_STORAGE_KEY = 'gallery:folders:v1';
const FOLDER_MAP_STORAGE_KEY = 'gallery:folder-map:v1';

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('nl-NL', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function photoKey(item: PurchasedPhotoItem): string {
  return `${item.conversationId}:${item.messageId}`;
}

export default function MijnFotosPage() {
  const [items, setItems] = useState<PurchasedPhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [folders, setFolders] = useState<string[]>([]);
  const [folderMap, setFolderMap] = useState<FolderMap>({});
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const skipNextPrefsSave = useRef(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/mijn-fotos', { credentials: 'include' });
        const data = (await res.json()) as { items?: PurchasedPhotoItem[]; error?: string };
        if (!res.ok) throw new Error(data.error || 'Foto’s laden mislukt');
        if (!cancel) setItems(Array.isArray(data.items) ? data.items : []);
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'Foto’s laden mislukt');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/user/gallery-prefs', { credentials: 'include' });
        if (res.ok) {
          const d = (await res.json()) as {
            folders?: string[];
            folderMap?: Record<string, string>;
          };
          if (cancel) return;
          const serverHas =
            (Array.isArray(d.folders) && d.folders.length > 0) ||
            (d.folderMap && Object.keys(d.folderMap).length > 0);
          if (serverHas) {
            setFolders(Array.isArray(d.folders) ? d.folders.filter(Boolean) : []);
            setFolderMap(
              d.folderMap && typeof d.folderMap === 'object' ? d.folderMap : {}
            );
            setPrefsReady(true);
            return;
          }
        }
      } catch {
        /* fallback localStorage */
      }
      try {
        const storedFolders = window.localStorage.getItem(FOLDERS_STORAGE_KEY);
        const parsedFolders = storedFolders ? (JSON.parse(storedFolders) as string[]) : [];
        const storedMap = window.localStorage.getItem(FOLDER_MAP_STORAGE_KEY);
        const parsedMap = storedMap ? (JSON.parse(storedMap) as FolderMap) : {};
        const fl = Array.isArray(parsedFolders) ? parsedFolders.filter(Boolean) : [];
        const fm = parsedMap && typeof parsedMap === 'object' ? parsedMap : {};
        if (!cancel) {
          setFolders(fl);
          setFolderMap(fm);
        }
        if (!cancel && (fl.length > 0 || Object.keys(fm).length > 0)) {
          await fetch('/api/user/gallery-prefs', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folders: fl, folderMap: fm }),
          }).catch(() => {});
        }
      } catch {
        if (!cancel) {
          setFolders([]);
          setFolderMap({});
        }
      }
      if (!cancel) setPrefsReady(true);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    if (skipNextPrefsSave.current) {
      skipNextPrefsSave.current = false;
      return;
    }
    const id = window.setTimeout(() => {
      void fetch('/api/user/gallery-prefs', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folders, folderMap }),
      }).catch(() => {
        try {
          window.localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
          window.localStorage.setItem(FOLDER_MAP_STORAGE_KEY, JSON.stringify(folderMap));
        } catch {
          /* ignore */
        }
      });
    }, 450);
    return () => window.clearTimeout(id);
  }, [folders, folderMap, prefsReady]);

  const sortedItems = [...items].sort(
    (a, b) => new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime()
  );
  const groupedByProfile = sortedItems.reduce<Record<string, PurchasedPhotoItem[]>>((acc, it) => {
    const key = it.profileName || 'Onbekend';
    if (!acc[key]) acc[key] = [];
    acc[key].push(it);
    return acc;
  }, {});
  const foldersWithItems = folders.map((folderName) => ({
    folderName,
    items: sortedItems.filter((it) => folderMap[photoKey(it)] === folderName),
  }));
  const unassigned = sortedItems.filter((it) => !folderMap[photoKey(it)]);
  const visibleItems =
    selectedFolder === null
      ? sortedItems
      : selectedFolder === '__unassigned__'
        ? unassigned
        : sortedItems.filter((it) => folderMap[photoKey(it)] === selectedFolder);

  const createFolder = () => {
    const value = newFolderName.trim();
    if (!value) return;
    if (folders.some((f) => f.toLowerCase() === value.toLowerCase())) return;
    setFolders((prev) => [...prev, value]);
    setNewFolderName('');
    setSelectedFolder(value);
  };

  const moveToFolder = (item: PurchasedPhotoItem, folderName: string) => {
    const key = photoKey(item);
    if (folderName === '__none__') {
      setFolderMap((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    setFolderMap((prev) => ({ ...prev, [key]: folderName }));
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-28 md:pb-10">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8 pt-16 md:pt-20">
        <div className="mb-6 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Gallerij</h1>
              <p className="mt-1 text-sm text-gray-600">
                Al je ontvangen en ontgrendelde foto&apos;s, overzichtelijk op één plek.
              </p>
            </div>
            <div className="rounded-2xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">
              {items.length} foto&apos;s totaal
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                viewMode === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
              }`}
            >
              Alles
            </button>
            <button
              type="button"
              onClick={() => setViewMode('profiles')}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                viewMode === 'profiles' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
              }`}
            >
              Per profiel
            </button>
            <button
              type="button"
              onClick={() => setViewMode('folders')}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                viewMode === 'folders' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
              }`}
            >
              Mappen
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
            Foto&apos;s laden…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
            Je hebt nog geen foto&apos;s gekocht.
          </div>
        ) : viewMode === 'profiles' ? (
          <div className="space-y-5">
            {Object.entries(groupedByProfile).map(([name, profileItems]) => (
              <section key={name} className="rounded-3xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-sm font-bold text-gray-900">{name}</h2>
                  <span className="text-xs text-gray-500">{profileItems.length} foto&apos;s</span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {profileItems.map((it) => (
                    <Link
                      key={`${it.conversationId}:${it.messageId}`}
                      href={`/berichten?chat=${it.conversationId}`}
                      className="overflow-hidden rounded-2xl border border-gray-200 bg-white"
                      title={`Open chat met ${it.profileName}`}
                    >
                      <img
                        src={photoSrc(it)}
                        alt=""
                        className="aspect-[3/4] w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : viewMode === 'folders' ? (
          <div className="space-y-5">
            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createFolder();
                  }}
                  placeholder="Nieuwe mapnaam"
                  className="h-10 min-w-[180px] flex-1 rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={createFolder}
                  className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-white"
                >
                  Map maken
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedFolder(null)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    selectedFolder === null ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  Alles
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFolder('__unassigned__')}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    selectedFolder === '__unassigned__'
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  Ongecategoriseerd ({unassigned.length})
                </button>
                {folders.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSelectedFolder(f)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      selectedFolder === f ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {f} ({foldersWithItems.find((x) => x.folderName === f)?.items.length ?? 0})
                  </button>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {visibleItems.map((it) => (
                <div
                  key={`${it.conversationId}:${it.messageId}`}
                  className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
                >
                  <Link href={`/berichten?chat=${it.conversationId}`} title={`Open chat met ${it.profileName}`}>
                    <img
                      src={photoSrc(it)}
                      alt=""
                      className="aspect-[3/4] w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </Link>
                  <div className="space-y-1.5 px-2.5 py-2">
                    <p className="truncate text-xs font-semibold text-gray-900">{it.profileName}</p>
                    <p className="text-[11px] text-gray-500">{formatWhen(it.unlockedAt)}</p>
                    <select
                      value={folderMap[photoKey(it)] ?? '__none__'}
                      onChange={(e) => moveToFolder(it, e.target.value)}
                      className="h-7 w-full rounded-lg border border-gray-200 bg-white px-2 text-[11px] text-gray-700"
                    >
                      <option value="__none__">Geen map</option>
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {sortedItems.map((it) => (
              <Link
                key={`${it.conversationId}:${it.messageId}`}
                href={`/berichten?chat=${it.conversationId}`}
                className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
                title={`Open chat met ${it.profileName}`}
              >
                <img
                  src={photoSrc(it)}
                  alt=""
                  className="aspect-[3/4] w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                  decoding="async"
                />
                <div className="px-2.5 py-2">
                  <p className="truncate text-xs font-semibold text-gray-900">{it.profileName}</p>
                  <p className="mt-0.5 text-[11px] text-gray-500">{formatWhen(it.unlockedAt)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

