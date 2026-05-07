import type { ChatMessage } from "./types/chat";
import { completeChat } from "./grok";

/** Maximum number of messages before we generate a summary */
const SUMMARY_EVERY_N_MESSAGES = 10;

/** Generate a short, dense summary of the conversation so far */
export async function generateConversationSummary(
  messages: ChatMessage[],
  profileName: string
): Promise<string> {
  if (messages.length < 6) return "";

  const recentMessages = messages.slice(-25); // last 25 messages max

  const historyText = recentMessages
    .map((m) => {
      const role = m.role === "user" ? "Hij" : profileName;
      return `${role}: ${m.content}`;
    })
    .join("\n");

  const prompt = `Samenvatting van een chat tussen een man en ${profileName}.

Recent gesprek:
${historyText}

Maak een **zeer korte** samenvatting (max 2 zinnen) van de huidige situatie, toon en belangrijkste thema's. 
Focus op:
- Haar huidige mood (speels, brutaal, afstandelijk, geil, moe, etc.)
- Hoe de man zich gedraagt
- Het niveau van intimiteit / spanning
- Belangrijke dingen die hij recent heeft gezegd of gevraagd

Schrijf puur feitelijk en neutraal. Geen meta-commentaar.`;

  try {
    const summary = await completeChat([
      { role: "system", content: "Je bent een objectieve observator van chats. Geef alleen korte, nuttige samenvattingen." },
      { role: "user", content: prompt }
    ]);

    return summary.trim();
  } catch (err) {
    console.error("[memory] Failed to generate summary:", err);
    return "Gesprek loopt al een tijdje. Ze lijkt geïnteresseerd maar houdt het luchtig.";
  }
}

/** Should we generate a new summary now? */
export function shouldGenerateSummary(messages: ChatMessage[]): boolean {
  const assistantMessages = messages.filter(m => m.role === "assistant").length;
  return assistantMessages > 0 && assistantMessages % SUMMARY_EVERY_N_MESSAGES === 0;
}

/** Add memory summary to system prompt */
export function injectMemoryIntoSystemPrompt(
  baseSystemPrompt: string,
  summary: string
): string {
  if (!summary) return baseSystemPrompt;

  return `${baseSystemPrompt}

=== RECENTE GESPREKSSAMENVATTING (belangrijk, gebruik dit) ===
${summary}
=== EINDE SAMENVATTING ===

Houd rekening met deze samenvatting bij je volgende antwoord. Blijf consistent met de toon en geschiedenis.`;
}
