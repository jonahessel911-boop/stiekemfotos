/** Rij voor creditverbruik per verstuurd bericht (API → client). */
export type UserMessageCreditLine = {
  messageId: string;
  createdAt: string;
  credits: number;
  profileName: string;
  conversationId: string;
  preview: string;
};
