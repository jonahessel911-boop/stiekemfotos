'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import { generateFeedPosts } from '@/lib/feedGenerator';
import type { Post } from '@/lib/mockData';
import type { Profile } from '@/lib/types/profile';
import { Heart, MessageCircle, Share2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { WelcomeHouseRulesModal } from '@/components/WelcomeHouseRulesModal';

export default function NieuwsfeedPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch('/api/profiles', { credentials: 'include' });
        const data = (await res.json()) as { profiles?: Profile[] };
        if (!cancel && Array.isArray(data.profiles)) {
          setProfiles(data.profiles);
        }
      } catch {
        if (!cancel) setProfiles([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const posts = useMemo(() => generateFeedPosts(profiles), [profiles]);
  const [liked, setLiked] = useState<Record<string, boolean>>({});

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-24 lg:pb-10">
      <WelcomeHouseRulesModal />
      <Navbar />

      <div className="mx-auto w-full max-w-screen-xl px-4 pt-12 sm:px-6 sm:pt-14 lg:px-8 lg:pt-20">
        <div className="sticky top-12 z-30 mb-6 flex border-b border-gray-200 bg-[var(--surface)] py-1 sm:top-14 lg:top-20">
          <button
            type="button"
            className="px-4 py-3 text-sm font-semibold border-b-2 border-primary text-primary sm:px-6 sm:text-base"
          >
            Alle posts
          </button>
          <button
            type="button"
            className="px-4 py-3 text-sm font-semibold text-gray-500 sm:px-6 sm:text-base"
          >
            Volgend
          </button>
        </div>

        <div className="mx-auto w-full max-w-4xl space-y-6 lg:space-y-8">
          {posts.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-gray-500">
              Nog geen posts. Bekijk{' '}
              <Link href="/profielen" className="font-semibold text-primary underline">
                profielen
              </Link>{' '}
              om te beginnen.
            </p>
          ) : (
            posts.map((post: Post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                liked={!!liked[post.id]}
                onToggleLike={() => {
                  const nowLiked = !liked[post.id];
                  setLiked((s) => ({ ...s, [post.id]: nowLiked }));
                  if (!nowLiked) return;
                  void fetch('/api/engagement/like', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      profileId: post.profileId,
                      source: 'post_like',
                    }),
                  }).catch(() => {
                    /* best effort */
                  });
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FeedPostCard({
  post,
  liked,
  onToggleLike,
}: {
  post: Post;
  liked: boolean;
  onToggleLike: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <img
            src={post.user.avatar}
            alt=""
            className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-2 ring-primary"
          />
          <div>
            <div className="font-semibold text-base">
              {post.user.name} • {post.user.age}
            </div>
            <div className="text-sm text-gray-500">
              {post.user.location} • {post.timestamp}
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="text-gray-400 text-xl">
          ···
        </Button>
      </div>

      <div className="p-4 md:p-6 pt-2">
        <p className="text-[17px] leading-relaxed text-gray-800 mb-4">{post.caption}</p>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <span className="text-sm text-gray-600">
            {post.likes} mensen vonden dit leuk
          </span>
          <div className="flex flex-wrap gap-3 text-sm text-gray-500 sm:gap-4">
            <button
              type="button"
              onClick={onToggleLike}
              className={`flex items-center gap-1 ${liked ? 'text-rose-500' : ''}`}
            >
              <Heart className={`w-5 h-5 ${liked ? 'fill-current' : ''}`} />
              Leuk
            </button>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-5 h-5" />
              Reactie
            </span>
            <span className="flex items-center gap-1">
              <Share2 className="w-5 h-5" />
              Deel
            </span>
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-gray-100">
          {post.comments.map((c, i) => (
            <p key={i} className="text-sm">
              <span className="font-semibold">{c.user}</span>{' '}
              <span className="text-gray-600">{c.text}</span>
            </p>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button className="flex-1 rounded-2xl py-4" onClick={onToggleLike}>
            Vind ik leuk
          </Button>
          <Link
            href={`/profielen/${post.profileId}`}
            className="inline-flex flex-1 items-center justify-center rounded-2xl bg-[#f97316] py-4 text-sm font-semibold text-white hover:bg-[#ea580c]"
          >
            Bekijk profiel
          </Link>
        </div>
      </div>
    </article>
  );
}
