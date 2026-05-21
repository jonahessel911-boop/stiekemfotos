export type DailyBucket = { date: string; value: number };

export type AdminAnalytics = {
  uniqueChatConversations: number;
  totalLockedImagesSent: number;
  totalUserImagesSent: number;
  totalImagesUnlocked: number;
  unlockConversionPercent: number | null;
  firstUserMessageToFirstLockedImagePercent: number | null;
  firstUnlockToSecondUnlockPercent: number | null;
  revenueEurTotal: number;
  totalCreditsPurchased: number;
  revenueByDay: DailyBucket[];
  purchasesByDay: DailyBucket[];
  signupsByDay: DailyBucket[];
  chartDays: number;
};

export type PeriodRow = {
  key: string;
  label: string;
  signups: number;
  conversions: number;
  revenueEur: number;
  signupToUserChatPct: number | null;
  userChatToUnlockFreePct: number | null;
  userChatToUnlockPaidPct: number | null;
  signupToPaidPct: number | null;
  reSignPct: number | null;
  used100CreditsPct: number | null;
  usedFreeCreditsPct: number | null;
};

export type PeriodOverview = {
  periods: PeriodRow[];
  totals: PeriodRow;
};

export type AdminChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type AdminConversation = {
  id: string;
  profileName: string;
  updatedAt: string;
  messages: number;
  lastMessage: string;
  history: AdminChatMessage[];
};

export type AdminUserConversations = {
  userId: string;
  userEmail: string;
  userName: string;
  conversations: AdminConversation[];
};

export type AdminData = {
  stats: {
    users: number;
    signups: number;
    purchases: number;
    conversations: number;
    /** Gesprekken waar het laatste bericht van de user is (nog niet beantwoord). */
    openChats: number;
  };
  analytics?: AdminAnalytics;
  signups: Array<{
    naam: string;
    email: string;
    leeftijd: number;
    createdAt: string;
    creditsSpent?: number;
  }>;
  users: Array<{
    id: string;
    email: string;
    naam: string;
    leeftijd: number;
    createdAt: string;
    emailVerified: boolean;
    conversations: number;
    userMessages: number;
    purchasesCount: number;
    purchasedCredits: number;
  }>;
  purchases: Array<{
    sessionId: string;
    userId: string;
    userEmail: string;
    credits: number;
    priceLabel: string;
    paidAt: string;
    fulfilledAt: string;
  }>;
  conversationsByUser: AdminUserConversations[];
};
