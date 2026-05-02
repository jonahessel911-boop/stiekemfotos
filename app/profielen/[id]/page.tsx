'use client';

import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Globe, Cake, Heart, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getProfileById } from '@/lib/profiles';
import { useCreditsPricing } from '@/components/CreditsPricingProvider';
import { getCreditsBalance, CREDITS_PER_MESSAGE } from '@/lib/credits-client';

export default function ProfielDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? '');
  const profile = getProfileById(id);
  const [starting, setStarting] = useState(false);
  const { openPricing } = useCreditsPricing();

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-gray-600">Profiel niet gevonden.</p>
        <Link href="/profielen" className="text-primary font-semibold">
          Terug naar profielen
        </Link>
      </div>
    );
  }

  const startChat = async () => {
    if (getCreditsBalance() < CREDITS_PER_MESSAGE) {
      openPricing();
      return;
    }
    setStarting(true);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profile.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/berichten?chat=${data.conversation.id}`);
    } catch {
      alert('Chat starten mislukt.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-28 md:pb-10">
      <Navbar />

      <div className="pt-16 md:pt-20 max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-3xl overflow-hidden shadow-lg bg-white">
            <img
              src={profile.photo}
              alt=""
              className="w-full aspect-[3/4] object-cover"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" className="py-6 rounded-2xl flex flex-col gap-1">
              <Heart className="w-6 h-6 text-primary" />
              <span className="text-xs">Like</span>
            </Button>
            <Button variant="outline" className="py-6 rounded-2xl flex flex-col gap-1 text-2xl">
              😉
              <span className="text-xs">Knipoog</span>
            </Button>
            <Button variant="outline" className="py-6 rounded-2xl flex flex-col gap-1">
              <span className="text-xl">⭐</span>
              <span className="text-xs">Volg</span>
            </Button>
          </div>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-primary text-white text-sm flex items-center justify-center font-bold">
                  i
                </span>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    {profile.name}, {profile.age}
                    {profile.isOnline && (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    )}
                  </h1>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-gray-500">
                Meer ▾
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-full">
                <Globe className="w-4 h-4" />
                {profile.location}
              </span>
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-full">
                <Cake className="w-4 h-4" />
                {1990 + (parseInt(profile.id, 10) % 10)}-0{1 + (parseInt(profile.id, 10) % 9)}-1
              </span>
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-full">
                <Heart className="w-4 h-4" />
                Vrijgezel
              </span>
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-full">
                <Briefcase className="w-4 h-4" />
                {profile.interests[0] ?? 'Creatief'}
              </span>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center px-4 py-3 border-b border-gray-100">
              <span className="font-semibold">Chat</span>
            </div>
            <div className="bg-sky-50/80 p-8 text-center">
              <p className="text-lg font-bold text-gray-900 mb-2">Durf de eerste stap te zetten</p>
              <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
                Knipoog gratis, of stuur een &apos;hallo&apos; met een kant-en-klare tekst ({CREDITS_PER_MESSAGE}{' '}
                credits per bericht).
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
                <Button variant="outline" className="flex-1 py-4 rounded-2xl border-2">
                  😉 Knipoog
                </Button>
                <Button
                  variant="default"
                  className="flex-1 py-4 rounded-2xl font-bold"
                  onClick={startChat}
                  disabled={starting}
                >
                  {starting ? '…' : '👋 Zeg hallo & open chat'}
                </Button>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 space-y-2">
              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                <span>Stickers</span>
                <span>•</span>
                <span>Foto</span>
                <span>•</span>
                <span>Laten we praten</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  placeholder="Type je bericht…"
                  className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-sm bg-gray-50"
                />
                <Button className="rounded-2xl px-6" onClick={startChat} disabled={starting}>
                  Verstuur
                </Button>
              </div>
              <p className="text-[10px] text-gray-400">
                Chat: 2 cr/min · Foto: 10 cr · Sticker: 5 cr
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
