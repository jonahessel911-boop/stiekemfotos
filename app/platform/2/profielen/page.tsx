'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import Platform2Chrome from '@/components/platform2/Platform2Chrome';
import type { Profile } from '@/lib/types/profile';
import { profilePhotoSrc } from '@/lib/profile-image-url';
import { isProfileDisplayedOnline } from '@/lib/profile-display-online';
import { pickNoPhotoProfileIds, profileShowsPhoto } from '@/lib/platform2-profiles';

export default function Platform2ProfielenPage() {
  const [filterGeslacht, setFilterGeslacht] = useState<'alle' | 'dames' | 'heren'>('alle');
  const [filterLeeftijd, setFilterLeeftijd] = useState('geen');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/profiles', { credentials: 'include', cache: 'no-store' });
        const data = (await res.json()) as { profiles?: Profile[]; error?: string };
        if (!cancel) {
          if (!res.ok) setError(data.error || 'Laden mislukt');
          else setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
        }
      } catch {
        if (!cancel) setError('Netwerkfout');
      } finally {
        if (!cancel) setLoaded(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let list = [...profiles];
    if (filterGeslacht === 'dames') {
      list = list.filter((p) => p.age >= 18);
    }
    if (filterLeeftijd !== 'geen') {
      const [min, max] = filterLeeftijd.split('-').map((n) => parseInt(n, 10));
      if (Number.isFinite(min) && Number.isFinite(max)) {
        list = list.filter((p) => p.age >= min && p.age <= max);
      }
    }
    return list;
  }, [profiles, filterGeslacht, filterLeeftijd]);

  const noPhotoIds = useMemo(() => pickNoPhotoProfileIds(profiles, 3), [profiles]);

  return (
    <Platform2Chrome>
      <div className="platform2-searchbar">
        <strong>Zoeken:</strong>
        <label>
          <input
            type="radio"
            name="g"
            checked={filterGeslacht === 'dames'}
            onChange={() => setFilterGeslacht('dames')}
          />{' '}
          Dames
        </label>
        <label>
          <input
            type="radio"
            name="g"
            checked={filterGeslacht === 'heren'}
            onChange={() => setFilterGeslacht('heren')}
          />{' '}
          Heren
        </label>
        <label>
          <input
            type="radio"
            name="g"
            checked={filterGeslacht === 'alle'}
            onChange={() => setFilterGeslacht('alle')}
          />{' '}
          Alles
        </label>
        <span>|</span>
        <label>
          Leeftijd{' '}
          <select value={filterLeeftijd} onChange={(e) => setFilterLeeftijd(e.target.value)}>
            <option value="geen">Geen voorkeur</option>
            <option value="18-25">18 - 25</option>
            <option value="26-35">26 - 35</option>
            <option value="36-50">36 - 50</option>
          </select>
        </label>
        <button type="button" className="platform2-btn" style={{ marginLeft: 'auto' }}>
          Zoeken
        </button>
      </div>
      <div className="platform2-results-bar">
        {!loaded
          ? 'Laden…'
          : error
            ? error
            : filtered.length === 0
              ? 'Geen resultaten'
              : `${filtered.length} resultaten`}
      </div>

      {!loaded ? (
        <p style={{ textAlign: 'center', color: '#666' }}>Even geduld…</p>
      ) : filtered.length === 0 ? (
        <p style={{ padding: 20, background: '#eee', border: '1px solid #ccc', textAlign: 'center' }}>
          Geen profielen gevonden. Pas je filters aan of{' '}
          <Link href="/platform/2/aanmaken">meld je gratis aan</Link>.
        </p>
      ) : (
        <div className="platform2-grid">
          {filtered.map((profile) => (
            <div key={profile.id} className="platform2-card">
              <Link href={`/platform/2/profielen/${profile.id}`} className="platform2-card-photo-link">
                {profileShowsPhoto(profile.id, noPhotoIds) ? (
                  <img
                    src={profilePhotoSrc(profile.photo, { widthCss: 200, heightCss: 200 })}
                    alt={profile.name}
                    width={200}
                    height={140}
                    loading="lazy"
                  />
                ) : (
                  <div className="platform2-card-no-photo" aria-hidden>
                    <span>Geen foto</span>
                  </div>
                )}
              </Link>
              <h3>
                {profile.name}, {profile.age}
              </h3>
              <p className="platform2-meta">{profile.location || 'Nederland'}</p>
              {isProfileDisplayedOnline(profile.id) ? (
                <p className="platform2-online">● Online</p>
              ) : (
                <p className="platform2-meta">Offline</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                <Link
                  href={`/platform/2/profielen/${profile.id}`}
                  className="platform2-btn platform2-btn-block"
                  style={{ fontSize: 11 }}
                >
                  Bekijk profiel
                </Link>
                <Link
                  href={`/platform/2/berichten?profile=${encodeURIComponent(profile.id)}`}
                  className="platform2-btn platform2-btn-block"
                  style={{ fontSize: 11, background: '#5a8a00' }}
                >
                  Stuur bericht
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Platform2Chrome>
  );
}
