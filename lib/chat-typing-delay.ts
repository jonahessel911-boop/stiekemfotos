/** Willekeurige pauze 10–30s vóór het AI-antwoord (menselijker). */
export function randomTypingDelayMs(): number {
  const min = 10_000;
  const max = 30_000;
  return min + Math.floor(Math.random() * (max - min + 1));
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
