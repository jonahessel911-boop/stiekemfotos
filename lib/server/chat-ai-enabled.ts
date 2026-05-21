/**
 * Chat-AI tijdelijk uit: alleen user-berichten opslaan; antwoorden via admin.
 * Zet CHAT_AI_ENABLED=1 om automatische profiel-antwoorden weer aan te zetten.
 */
export function isChatAiEnabled(): boolean {
  const v = process.env.CHAT_AI_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
