'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Platform2Chrome from '@/components/platform2/Platform2Chrome';
import type { Profile } from '@/lib/types/profile';
import { profilePhotoSrc } from '@/lib/profile-image-url';
import { isProfileDisplayedOnline } from '@/lib/profile-display-online';
import { pickNoPhotoProfileIds, profileShowsPhoto } from '@/lib/platform2-profiles';

export default function Platform2ProfielDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? '');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [noPhotoIds, setNoPhotoIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [profileRes, listRes] = await Promise.all([
          fetch(`/api/profiles/${id}`, { credentials: 'include' }),
          fetch('/api/profiles', { credentials: 'include', cache: 'no-store' }),
        ]);
        const profileData = (await profileRes.json()) as { profile?: Profile };
        const listData = (await listRes.json()) as { profiles?: Profile[] };
        if (!cancel) {
          setProfile(profileRes.ok ? (profileData.profile ?? null) : null);
          setNoPhotoIds(pickNoPhotoProfileIds(listData.profiles ?? [], 3));
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id]);

  const startChat = () => {
    router.push(`/platform/2/berichten?profile=${encodeURIComponent(id)}`);
  };

  return (
    <Platform2Chrome>
      <p className="platform2-breadcrumb">
        <Link href="/platform/2/profielen">← Terug naar zoeken</Link>
      </p>

      {loading ? (
        <p>Profiel laden…</p>
      ) : !profile ? (
        <p>Profiel niet gevonden.</p>
      ) : (
        <div className="platform2-profile-detail">
          <div>
            {profileShowsPhoto(profile.id, noPhotoIds) ? (
              <img
                src={profilePhotoSrc(profile.photo, { widthCss: 400, heightCss: 500 })}
                alt={profile.name}
                width={280}
                height={350}
              />
            ) : (
              <div className="platform2-card-no-photo platform2-detail-no-photo">
                <span>Geen profielfoto</span>
              </div>
            )}
            {profileShowsPhoto(profile.id, noPhotoIds) ? (
              <p style={{ marginTop: 8, fontSize: 12 }}>
                {profile.photosCount} foto&apos;s
                {profile.videoCount ? ` · ${profile.videoCount} video` : ''}
              </p>
            ) : null}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>
              {profile.name}, {profile.age}
            </h1>
            <p>
              <strong>Woonplaats:</strong> {profile.location || 'Nederland'}
            </p>
            {isProfileDisplayedOnline(profile.id) ? (
              <p className="platform2-online">Nu online</p>
            ) : null}
            <p style={{ lineHeight: 1.5, margin: '12px 0' }}>{profile.bio}</p>
            {profile.interests?.length ? (
              <p>
                <strong>Interesses:</strong> {profile.interests.join(', ')}
              </p>
            ) : null}
            <p style={{ marginTop: 16 }}>
              <button type="button" className="platform2-btn platform2-btn-lg" onClick={startChat}>
                Stuur bericht
              </button>
            </p>
          </div>
        </div>
      )}
    </Platform2Chrome>
  );
}
