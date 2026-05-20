import {
  filterChatLinesForAmsterdamTime,
  getAmsterdamHour,
  isAmsterdamEveningOrLater,
  isAmsterdamNight,
} from "./amsterdam-time";
import type { ChatMessage } from "./types/chat";

/** Mood states that influence reply behavior, speed and tone */
export type ChatMood = 
  | 'playful' 
  | 'bratty' 
  | 'affectionate' 
  | 'distant' 
  | 'horny' 
  | 'tired' 
  | 'engaged';

export interface ConversationState {
  mood: ChatMood;
  energy: number;           // 0-100, higher = more responsive
  lastReplyAt: string;
  messagesSinceLastReply: number;
  ghostProbability: number; // 0-1, chance to temporarily ghost
  lastSpontaneousMessageAt?: string;
  typingStreak?: number;    // how many times she's typed and stopped
}

/** Default starting state for a new conversation */
export function createInitialConversationState(): ConversationState {
  return {
    mood: 'playful',
    energy: 65,
    lastReplyAt: new Date().toISOString(),
    messagesSinceLastReply: 0,
    ghostProbability: 0.12,
  };
}

/** Update state based on user behavior and time passed */
export function updateConversationState(
  state: ConversationState,
  newUserMessages: number,
  now: Date = new Date()
): ConversationState {
  const updated = { ...state };
  updated.messagesSinceLastReply += newUserMessages;

  const minutesSinceLastReply = 
    (now.getTime() - new Date(state.lastReplyAt).getTime()) / 60000;

  // Energy decays slowly over time, recovers with engagement
  if (minutesSinceLastReply > 30) {
    updated.energy = Math.max(25, updated.energy - 12);
  } else if (newUserMessages >= 2) {
    updated.energy = Math.min(100, updated.energy + 18);
  }

  // Mood shifts
  if (updated.messagesSinceLastReply > 5 && Math.random() < 0.3) {
    updated.mood = Math.random() < 0.6 ? 'bratty' : 'distant';
  } else if (updated.energy > 75 && Math.random() < 0.4) {
    updated.mood = 'affectionate';
  }

  // Increase ghost probability if ignored for long
  if (minutesSinceLastReply > 90) {
    updated.ghostProbability = Math.min(0.65, updated.ghostProbability + 0.15);
  }

  return updated;
}

/** Realistic reply delay — skewed toward fast replies, occasional long pauses */
export function getRealisticReplyDelay(state: ConversationState): number {
  void state;
  // Product focus: snappy chat UX — typing indicator runs client-side; server must not add multi-second waits.
  return 120 + Math.random() * 380; // ~0.12s - 0.5s (parallel with Grok where used)
}

/** Decide whether to reply immediately or wait for a reminder */
export function shouldReplyNow(state: ConversationState): boolean {
  void state;
  // Always reply immediately to avoid "profiles reageren niet" behavior.
  return true;
}

/** Simulate realistic typing behavior (including cancellations) */
export function simulateTypingBehavior(
  state: ConversationState,
  delayMs: number
): Array<{ startedAt: string; stoppedAt?: string; sent?: boolean }> {
  const events: Array<{ startedAt: string; stoppedAt?: string; sent?: boolean }> = [];
  const now = Date.now();

  // Always start typing
  events.push({ startedAt: new Date(now).toISOString() });

  // Sometimes cancel typing (very human)
  if (Math.random() < 0.28 && delayMs > 18000) {
    const cancelAfter = 3000 + Math.random() * 7000;
    events[0]!.stoppedAt = new Date(now + cancelAfter).toISOString();
    
    // Start typing again later
    if (Math.random() < 0.7) {
      events.push({
        startedAt: new Date(now + cancelAfter + 4500).toISOString()
      });
    }
  }

  // Final event is the send
  events.push({
    startedAt: new Date(now + delayMs - 2200).toISOString(),
    sent: true
  });

  return events;
}

/** Chance to send a spontaneous message (feels like she has a life) — lowered to prevent spam */
export function shouldSendSpontaneousMessage(state: ConversationState): boolean {
  if (state.energy < 40) return false;
  if (state.mood === 'distant') return Math.random() < 0.06;
  if (state.messagesSinceLastReply > 3) return Math.random() < 0.18;
  return Math.random() < 0.11; // significantly reduced to avoid constant messages
}

/** Generate a short spontaneous or follow-up message — time-aware (Amsterdam timezone), logical, low emotion */
export function generateSpontaneousMessage(
  profileName: string,
  mood: ChatMood
): string {
  const now = new Date();
  const hour = getAmsterdamHour(now);
  const isNight = isAmsterdamNight(now);
  const isEvening = hour >= 19 && hour < 22;

  const lines: Record<ChatMood, string[]> = {
    playful: [
      "ben je daar nog?",
      "hoe gaat het eigenlijk?",
      "wat ben je aan het doen?",
      "heb je nog zin om te praten?",
      isEvening ? "ben je vanavond nog online?" : "hoe was je dag eigenlijk?",
    ].filter(Boolean) as string[],
    bratty: [
      "dus je laat me wachten",
      "ben je nu alweer stil",
      "je bent wel snel weg",
      "hmm oké dan",
    ],
    affectionate: [
      "ben je er nog?",
      "waar ben je mee bezig?",
      "alles goed?",
      "spreek je later weer",
    ],
    distant: [
      "ben even druk",
      isEvening ? "vandaag even niet zoveel zin" : "ik spreek je later",
      "later misschien",
    ],
    horny: [
      "heb je nog zin om verder te praten?",
      "ben benieuwd wat je wilt",
      isAmsterdamEveningOrLater(now) ? "kom je nog terug vanavond?" : "kom je nog terug?",
      "wat wil je eigenlijk?",
    ],
    tired: [
      isNight ? "ga je al slapen?" : "ben nu even moe",
      "morgen beter",
      "niet zo spraakzaam nu",
      isEvening ? "ben best wel moe eigenlijk" : "heb even geen energie",
    ].filter(Boolean) as string[],
    engaged: [
      "wat ben je aan het doen?",
      "vertel eens",
      "benieuwd naar je dag",
      "hoe gaat het?",
    ]
  };

  let pool = filterChatLinesForAmsterdamTime(lines[mood] || lines.playful, now);

  if (pool.length === 0) {
    pool = ["ben je daar nog?"];
  }

  return pool[Math.floor(Math.random() * pool.length)]!;
}
