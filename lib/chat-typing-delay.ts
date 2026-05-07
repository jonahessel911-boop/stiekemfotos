/**
 * Na een user-bericht: menselijke, skewed pauze.
 * Meeste replies komen binnen 8-45 seconden. Af en toe een langere pauze tot 2 minuten.
 * Dit voelt natuurlijker dan een platte 0-120s uniform distributie.
 */
export const USER_REPLY_TYPING_DELAY_MAX_MS = 120_000;

export function randomTypingDelayMs(): number {
  const r = Math.random();

  if (r < 0.35) {
    // Snelle reactie (vaak)
    return 8000 + Math.floor(Math.random() * 17000); // 8-25s
  } else if (r < 0.75) {
    // Normale reactie
    return 18000 + Math.floor(Math.random() * 27000); // 18-45s
  } else if (r < 0.92) {
    // Iets langer nadenken
    return 45000 + Math.floor(Math.random() * 35000); // 45-80s
  } else {
    // Af en toe echt even weg (max 2 min)
    return 70000 + Math.floor(Math.random() * 50000); // 70-120s
  }
}

/**
 * Eerste reply in een thread zonder user-regels in deze batch (zeldzaam): kort houden.
 */
export function firstReplyTypingDelayMs(): number {
  const min = 250;
  const max = 700;
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function replyTypingDelayMsForConversation(messages: { role: string }[]): number {
  const userCount = messages.filter((m) => m.role === "user").length;
  return userCount === 0 ? firstReplyTypingDelayMs() : randomTypingDelayMs();
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
