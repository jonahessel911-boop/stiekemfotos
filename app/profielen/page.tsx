'use client';

import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { mockProfiles } from '@/lib/mockData';
import { Heart, MapPin, Users, Camera, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCreditsPricing } from '@/components/CreditsPricingProvider';
import { getCreditsBalance, CREDITS_PER_MESSAGE } from '@/lib/credits-client';

export default function ProfielenPage() {
  const router = useRouter();
  const { openPricing } = useCreditsPricing();
  const [activeTab, setActiveTab] = useState<'all' | 'online' | 'following'>('all');
  const [likedProfiles, setLikedProfiles] = useState<string[]>([]);
  const [starting, setStarting] = useState<string | null>(null);

  const startChat = async (profileId: string) => {
    if (getCreditsBalance() < CREDITS_PER_MESSAGE) {
      openPricing();
      return;
    }
    setStarting(profileId);
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/berichten?chat=${data.conversation.id}`);
    } catch {
      alert('Chat starten mislukt.');
    } finally {
      setStarting(null);
    }
  };

  const filteredProfiles = mockProfiles.filter(profile => {
    if (activeTab === 'online') return profile.isOnline;
    return true;
  });

  const toggleLike = (id: string) => {
    if (likedProfiles.includes(id)) {
      setLikedProfiles(likedProfiles.filter(p => p !== id));
    } else {
      setLikedProfiles([...likedProfiles, id]);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-28 md:pb-10">
      <Navbar />

      <div className="pt-12 sm:pt-14 md:pt-20 max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
        {/* Header with Tabs - exact BestDates style */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">Profielen</h1>
            <p className="text-gray-500 mt-1">Ontdek nieuwe connecties</p>
          </div>
          
          <Button variant="outline" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Filters
          </Button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-200 mb-10">
          <button 
            onClick={() => setActiveTab('all')}
            className={`px-10 py-4 font-medium text-lg transition-all border-b-2 ${activeTab === 'all' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Alle
          </button>
          <button 
            onClick={() => setActiveTab('online')}
            className={`px-10 py-4 font-medium text-lg transition-all border-b-2 ${activeTab === 'online' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Online
          </button>
          <button 
            onClick={() => setActiveTab('following')}
            className={`px-10 py-4 font-medium text-lg transition-all border-b-2 ${activeTab === 'following' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Volgend
          </button>
        </div>

        {/* Profile Grid - pixel-perfect to BestDates screenshots */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProfiles.map((profile) => (
            <div 
              key={profile.id}
              className="group bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-200 cursor-pointer"
            >
              <div className="relative overflow-hidden">
                <img
                  src={profile.photo}
                  alt={profile.name}
                  className="w-full h-40 sm:h-44 md:h-40 object-cover object-top"
                />
                
                {/* Heart - exact top-right position like BestDates */}
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleLike(profile.id); }}
                  className="absolute top-4 right-4 w-9 h-9 bg-white rounded-2xl flex items-center justify-center shadow-md hover:scale-110 transition-all z-10"
                >
                  <Heart 
                    className={`w-5 h-5 transition-all ${likedProfiles.includes(profile.id) 
                      ? 'fill-[#ff3b5c] text-[#ff3b5c]' 
                      : 'text-gray-400 group-hover:text-gray-600'}`} 
                  />
                </button>

                {/* Online dot */}
                {profile.isOnline && (
                  <div className="absolute bottom-4 left-4 flex items-center gap-1.5 bg-white text-emerald-500 text-[10px] font-medium px-2.5 py-px rounded-full shadow">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-white"></div>
                  </div>
                )}
                
                {/* Photo + video counts */}
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                  <div />
                  <div className="flex gap-2">
                    <span className="bg-black/75 text-white text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 font-medium">
                      <Camera className="w-3.5 h-3.5" />
                      {profile.photosCount}
                    </span>
                    {profile.videoCount != null && profile.videoCount > 0 ? (
                      <span className="bg-black/75 text-white text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 font-medium">
                        <Video className="w-3.5 h-3.5" />
                        {profile.videoCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              
              <div className="px-5 pt-5 pb-6">
                <div className="flex items-baseline gap-2 mb-1">
                  <div className="font-bold text-2xl text-gray-900">{profile.name}</div>
                  <div className="text-xl text-gray-400">,</div>
                  <div className="text-2xl font-semibold text-gray-900">{profile.age}</div>
                </div>
                
                <div className="flex items-center text-sm text-gray-500 mb-5">
                  <MapPin className="w-4 h-4 mr-1" />
                  {profile.location}
                </div>
                
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/profielen/${profile.id}`}
                    className="w-full text-center py-3 rounded-2xl border-2 border-primary text-primary font-bold text-sm hover:bg-primary/5"
                  >
                    Bekijk profiel
                  </Link>
                  <Button
                    type="button"
                    variant="default"
                    className="w-full h-12 text-base font-bold rounded-2xl shadow-sm"
                    onClick={() => startChat(profile.id)}
                    disabled={starting === profile.id}
                  >
                    {starting === profile.id ? '…' : 'Start gesprek'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
