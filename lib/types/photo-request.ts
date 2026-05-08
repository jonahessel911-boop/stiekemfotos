export interface PhotoRequestComment {
  id: string;
  profileId?: string;
  profileName?: string;
  profileAvatar?: string;
  userId?: string;
  userName?: string;
  authorType: "profile" | "user";
  text: string;
  createdAt: string;
  sentInboxMessage?: boolean;
}

export interface PhotoRequest {
  id: string;
  ownerUserId: string;
  description: string;
  photoType: string;
  photoCategory?: "naakt" | "lingerie" | "casual";
  maxCredits: number;
  wantedWhen?: "vandaag" | "morgen" | "binnen_1_week";
  createdAt: string;
  updatedAt: string;
  comments: PhotoRequestComment[];
}
