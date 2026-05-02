'use client';

import React, { useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import { generateFeedPosts } from '@/lib/feedGenerator';
import type { Post } from '@/lib/mockData';
import { Heart, MessageCircle, Share2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { WelcomeHouseRulesModal } from '@/components/WelcomeHouseRulesModal';

export default function NieuwsfeedPage() {
  const posts = useMemo(() => generateFeedPosts(), []);
  const [liked, setLiked] = useState<Record<string, boolean>>({});

  return (
    <div className="min-h-screen bg-[var(--surface)] pb-24">
      <WelcomeHouseRulesModal />
      <Navbar />

      <div className="pt-12 sm:pt-14 md:pt-20 max-w-2xl mx-auto px-4">
        <div className="flex border-b border-gray-200 mb-6 sticky top-12 sm:top-14 md:top-20 bg-[var(--surface)] z-30 py-1">
          <button
            type="button"
            className="px-6 py-3 text-base font-semibold border-b-2 border-primary text-primary"
          >
            Alle posts
          </button>
          <button
            type="button"
            className="px-6 py-3 text-base font-semibold text-gray-500"
          >
            Volgend
          </button>
        </div>

        <div className="space-y-8">
          {posts.map((post: Post) => (
            <FeedPostCard
              key={post.id}
              post={post}
              liked={!!liked[post.id]}
              onToggleLike={() =>
                setLiked((s) => ({ ...s, [post.id]: !s[post.id] }))
              }
            />
          ))}
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
    <article className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <img
            src={post.user.avatar}
            alt=""
            className="w-11 h-11 rounded-2xl object-cover ring-2 ring-primary/10"
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

      <div className="relative">
        <img
          src={post.image}
          alt=""
          className="w-full h-auto object-cover max-h-[480px]"
        />
      </div>

      <div className="p-4 md:p-6">
        <p className="text-[17px] leading-relaxed text-gray-800 mb-4">{post.caption}</p>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <span className="text-sm text-gray-600">
            {post.likes} mensen vonden dit leuk
          </span>
          <div className="flex gap-4 text-sm text-gray-500">
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

        <div className="flex gap-3 mt-6">
          <Button className="flex-1 py-4 rounded-2xl" onClick={onToggleLike}>
            Vind ik leuk
          </Button>
          <Link
            href="/profielen"
            className="flex-1 inline-flex items-center justify-center rounded-2xl bg-[#f97316] py-4 text-sm font-semibold text-white hover:bg-[#ea580c]"
          >
            Bekijk profielen
          </Link>
        </div>
      </div>
    </article>
  );
}
