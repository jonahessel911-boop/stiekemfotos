export type { Profile } from "@/lib/types/profile";
export { allProfiles as mockProfiles } from "@/lib/profiles";

export interface Post {
  id: string;
  /** Profiel-UUID of statisch id voor deep links + engagement. */
  profileId: string;
  user: {
    name: string;
    avatar: string;
    age: number;
    location: string;
  };
  /** Optioneel: grote post-afbeelding (nieuwsfeed gebruikt alleen avatar). */
  image?: string;
  caption: string;
  likes: number;
  liked: boolean;
  timestamp: string;
  comments: Array<{
    user: string;
    text: string;
  }>;
}

export interface ChatPreview {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  isOnline: boolean;
}

/** @deprecated use feed from lib/feedGenerator */
export const mockPosts: Post[] = [];

export const mockChats: ChatPreview[] = [
  {
    id: "c1",
    name: "Emma",
    avatar: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&h=150&fit=crop",
    lastMessage: "Hey, heb je mijn vorige bericht gezien? 😊",
    timestamp: "14:22",
    unread: 2,
    isOnline: true,
  },
  {
    id: "c2",
    name: "Lisa",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop",
    lastMessage: "Leuk je profiel! Laten we eens afspreken.",
    timestamp: "11:05",
    unread: 0,
    isOnline: false,
  },
];
