'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Platform2Chrome from '@/components/platform2/Platform2Chrome';
import type { UserMyProfile } from '@/lib/user-my-profile';

export default function Platform2MijnProfielPage() {
  const [profile, setProfile] = useState<UserMyProfile | null>(null);
  const [naam, setNaam] = useState('');
  const [leeftijd, setLeeftijd] = useState('');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('');
  const [hobbiesRaw, setHobbiesRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/user/my-profile', { credentials: 'include' });
        const data = (await res.json()) as { profile?: UserMyProfile; error?: string };
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/platform/2/aanmelden?next=%2Fplatform%2F2%2Fmijn-profiel';
            return;
          }
          throw new Error(data.error || 'Laden mislukt');
        }
        if (!cancel && data.profile) {
          setProfile(data.profile);
          setNaam(data.profile.naam);
          setLeeftijd(String(data.profile.leeftijd));
          setLocation(data.profile.profileLocation);
          setBio(data.profile.profileBio);
          setHobbiesRaw(data.profile.profileHobbies.join(', '));
        }
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : 'Fout');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const age = parseInt(leeftijd, 10);
    if (!leeftijd.trim() || !Number.isFinite(age) || age < 18 || age > 99) {
      setError('Vul een geldige leeftijd in (18–99).');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/user/my-profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          naam: naam.trim(),
          leeftijd: age,
          profileLocation: location.trim(),
          profileBio: bio.trim(),
          profileHobbies: hobbiesRaw,
        }),
      });
      const data = (await res.json()) as { profile?: UserMyProfile; error?: string };
      if (!res.ok) throw new Error(data.error || 'Opslaan mislukt');
      if (data.profile) {
        setProfile(data.profile);
        setNotice('Profiel opgeslagen.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout');
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/user/my-profile/photo', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = (await res.json()) as {
        profile?: UserMyProfile;
        profilePhotoUrl?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Upload mislukt');
      const url = data.profilePhotoUrl ?? data.profile?.profilePhotoUrl ?? null;
      setProfile((p) => (p && url ? { ...p, profilePhotoUrl: url } : p));
      setNotice('Profielfoto geüpload.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload mislukt');
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void uploadPhoto(file);
    e.target.value = '';
  };

  const photoUrl = profile?.profilePhotoUrl;

  return (
    <Platform2Chrome>
      <h1 className="platform2-page-title">Mijn profiel</h1>
      <p className="platform2-page-sub">
        Laat anderen zien wie je bent. Je profielfoto en bio zijn zichtbaar wanneer je contact legt.
      </p>

      {loading ? (
        <p>Laden…</p>
      ) : (
        <div className="platform2-profile-edit">
          <div className="platform2-profile-photo-box">
            <div className="platform2-profile-photo-frame">
              {photoUrl ? (
                <img src={photoUrl} alt="Profielfoto" width={160} height={200} />
              ) : (
                <span className="platform2-profile-photo-placeholder">Geen foto</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="platform2-file-input"
              onChange={onFileChange}
            />
            <button
              type="button"
              className="platform2-btn platform2-btn-block"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploaden…' : 'Foto uploaden'}
            </button>
            <p className="platform2-hint">JPG, PNG of WebP — max. 5 MB</p>
          </div>

          <form className="platform2-form platform2-profile-form" onSubmit={save}>
            {error ? <div className="platform2-error">{error}</div> : null}
            {notice ? (
              <div
                className="platform2-error"
                style={{ background: '#e8f4c8', borderColor: '#9bc96a', color: '#224400' }}
              >
                {notice}
              </div>
            ) : null}

            <label>
              <b>Gebruikersnaam</b>
              <input type="text" required maxLength={40} value={naam} onChange={(e) => setNaam(e.target.value)} />
            </label>
            <div className="platform2-row2">
              <label>
                <b>Leeftijd</b>
                <input
                  type="number"
                  min={18}
                  max={99}
                  required
                  placeholder="Leeftijd"
                  value={leeftijd}
                  onChange={(e) => setLeeftijd(e.target.value)}
                />
              </label>
              <label>
                <b>Woonplaats</b>
                <input
                  type="text"
                  placeholder="bijv. Amsterdam"
                  maxLength={80}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </label>
            </div>
            <label>
              <b>Over mij</b>
              <textarea
                rows={5}
                maxLength={2000}
                placeholder="Vertel iets over jezelf…"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="platform2-textarea"
              />
            </label>
            <label>
              <b>Hobby&apos;s & interesses</b>
              <input
                type="text"
                placeholder="sport, reizen, koken (komma gescheiden)"
                value={hobbiesRaw}
                onChange={(e) => setHobbiesRaw(e.target.value)}
              />
            </label>
            {profile?.zoekEigenschappen?.length ? (
              <p className="platform2-hint">
                Je zoekt:{' '}
                {profile.zoekEigenschappen
                  .map((z) => z.replace(/^zoekt_/, '').replace(/_/g, ' '))
                  .join(', ')}
              </p>
            ) : null}
            <button type="submit" className="platform2-btn platform2-btn-lg platform2-btn-block" disabled={saving}>
              {saving ? 'Opslaan…' : 'Profiel opslaan'}
            </button>
          </form>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 12 }}>
        <Link href="/platform/2/profielen">← Terug naar profielen</Link>
      </p>
    </Platform2Chrome>
  );
}
