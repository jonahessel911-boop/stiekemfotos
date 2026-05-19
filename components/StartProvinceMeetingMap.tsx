'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { NL_MAP_VIEWBOX, PROVINCE_PATHS } from '@/app/lander/9/province-paths';
import { START_PROVINCE_MAP, parseViewBox, spotToPercent } from '@/lib/start-province-map-data';

type ProfileSlide = { src: string; alt?: string };

type Props = {
  profileSlides: ProfileSlide[];
  onContinue: () => void;
};

function MapLabel() {
  return <p className="start-map-section-label text-center">Kaart met ontmoetingsplaatsen</p>;
}

export default function StartProvinceMeetingMap({ profileSlides, onContinue }: Props) {
  const [phase, setPhase] = useState<'select' | 'map'>('select');
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const province = PROVINCE_PATHS.find((p) => p.id === provinceId);
  const mapMeta = provinceId ? START_PROVINCE_MAP[provinceId] : null;

  const viewBoxParsed = useMemo(
    () => (mapMeta ? parseViewBox(mapMeta.viewBox) : null),
    [mapMeta]
  );

  const selectProvince = (id: string) => {
    setProvinceId(id);
    setPhase('map');
  };

  if (phase === 'select') {
    return (
      <div className="start-map-flow space-y-4">
        <MapLabel />
        <h2 className="text-center text-xl md:text-2xl text-gray-900 px-1">Selecteer uw provincie</h2>

        <div className="start-map-card rounded-sm border-2 border-[#dc2626] bg-white p-3">
          <svg
            viewBox={NL_MAP_VIEWBOX}
            className="mx-auto w-full max-w-[300px] touch-manipulation"
            role="img"
            aria-label="Kaart van Nederland — klik op een provincie"
          >
            {PROVINCE_PATHS.map((p) => {
              const active = provinceId === p.id || hoveredId === p.id;
              return (
                <g
                  key={p.id}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  aria-label={p.name}
                  onClick={() => selectProvince(p.id)}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectProvince(p.id);
                    }
                  }}
                >
                  {p.paths.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      fill={active ? '#dc2626' : '#fecaca'}
                      stroke={active ? '#7f1d1d' : '#b91c1c'}
                      strokeWidth={active ? 0.85 : 0.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="transition-colors duration-200"
                    />
                  ))}
                </g>
              );
            })}
          </svg>
          <p className="mt-2 text-center text-xs text-gray-600">Tik op uw provincie</p>
        </div>

        <label className="block text-sm text-gray-800">
          <span className="sr-only">Provincie</span>
          <select
            className="start-map-select w-full border-2 border-[#737373] bg-white px-3 py-2.5 text-gray-900"
            value={provinceId ?? ''}
            onChange={(e) => {
              if (e.target.value) selectProvince(e.target.value);
            }}
          >
            <option value="">Of kies uit de lijst…</option>
            {PROVINCE_PATHS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  if (!province || !mapMeta || !viewBoxParsed) return null;

  return (
    <div className="start-map-flow space-y-4">
      <MapLabel />
      <div className="text-center">
        <p className="text-sm text-gray-700">{province.name}</p>
        <h3 className="text-lg font-bold text-gray-900">Ontmoetingsplaatsen</h3>
      </div>

      <div className="start-map-card start-map-province-wrap rounded-sm border-2 border-[#dc2626] bg-white p-2">
        <div
          className="relative mx-auto w-full max-w-[320px]"
          style={{ aspectRatio: `${viewBoxParsed.w} / ${viewBoxParsed.h}` }}
        >
          <svg viewBox={mapMeta.viewBox} className="h-full w-full" role="img" aria-hidden>
            {province.paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="#fee2e2"
                stroke="#dc2626"
                strokeWidth={0.7}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>

          {mapMeta.spots.map((spot, i) => {
            const { left, top } = spotToPercent(spot, viewBoxParsed);
            const profile = profileSlides[i % profileSlides.length];
            return (
              <div
                key={`${provinceId}-${i}`}
                className="start-map-marker pointer-events-none absolute"
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                }}
              >
                <div className="start-map-marker-inner">
                  <span className="start-map-marker-avatar overflow-hidden rounded-full border border-white shadow-sm">
                    <Image
                      src={profile.src}
                      alt={profile.alt ?? ''}
                      width={28}
                      height={28}
                      className="h-7 w-7 object-cover object-center"
                    />
                  </span>
                  <span className="start-map-marker-online">
                    <span className="start-online-dot start-map-online-dot" aria-hidden />
                    Nu online
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="start-btn start-btn-primary w-full py-4 px-6 text-center"
      >
        Bekijk of er nog plaats is
      </button>
    </div>
  );
}
