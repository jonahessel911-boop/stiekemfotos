import type { IntimacyTier } from "@/lib/intimacy-tier";

export type VoiceTriggerOpts = {
  intimacyTier?: IntimacyTier;
  hasImage?: boolean;
};

/** Pas na genoeg berichten (warm gesprek); niet meteen aan het begin. */
export const MIN_INTIMACY_TIER_FOR_ASSISTANT_VOICE = 2 satisfies IntimacyTier;

/** Vaste TTS-tekst: ultrakort, enthousiast — de echte inhoud staat in het chatbericht. */
export const ASSISTANT_VOICE_TTS_PHRASE = "Hoiiii!";

export function voiceReplyAllowedForTier(tier: IntimacyTier): boolean {
  return tier >= MIN_INTIMACY_TIER_FOR_ASSISTANT_VOICE;
}

/**
 * Hij twijfelt of vraagt bewijs dat je echt bent — dan mag er wél meteen een kort "hoi"-clip komen
 * (ook in tier 0–1), los van de normale spraak-drempel.
 */
export function triggersTrustProofVoiceRequest(message: string): boolean {
  const t = message.toLowerCase().trim();
  if (!t) return false;

  if (/\bbewijs\b/.test(t) && /(echt|nep|fake|stem|spraak|hoort|hoi|persoon)/.test(t))
    return true;
  if (/ben je (echt|wel echt|nou echt)/i.test(message)) return true;
  if (/(echte persoon|geen bot|geen fake|niet nep|is dit echt)/i.test(t)) return true;
  if (/\b(nep|fake|scam|oplich|opgelicht|catfish)\b/.test(t)) return true;
  if (/\btwijfel\b/.test(t) && /(echt|jou|je )\b/.test(t)) return true;
  if (/ik geloof je niet/.test(t)) return true;
  if (/\b(robot|chatbot)\b/.test(t) && /(ben|bent|jij|je )\b/.test(t)) return true;
  if (/(laat (me )?horen|stem (horen|van je)|hoor ik je)/.test(t)) return true;
  if (
    /(kan|kun) je (wat |iets )?inspreken/.test(t) &&
    /(echt|bewijs|hoi|hoort|stem|geloof|nep|fake)/.test(t)
  )
    return true;
  if (/\binspreek/.test(t) && /(gewoon |alleen |zeg |)\s*ho+i+/i.test(message)) return true;
  if (
    /^(gewoon |alleen |zeg |)\s*ho+i+\s*!?\s*$/i.test(message.trim()) ||
    /^(alleen maar |)(een )?ho+i+\s*!?\s*$/i.test(message.trim())
  )
    return true;
  if (/\b(zeg|doe|stuur) (maar |)(een |)(kort |)(hoi|hey)\b/i.test(t)) return true;

  return false;
}

/**
 * Alleen spraak (TTS) als hij er expliciet om vraagt of duidelijk om een spraakbericht vraagt.
 * Geen automatische spraak op foto / random. Niet in tier 0–1 (beginfase).
 */
export function triggersAssistantVoiceReply(
  message: string,
  opts?: VoiceTriggerOpts
): boolean {
  if (
    opts?.intimacyTier !== undefined &&
    !voiceReplyAllowedForTier(opts.intimacyTier)
  ) {
    return false;
  }

  const t = message.toLowerCase().trim();

  if (/\bspraakbericht/i.test(message)) return true;
  if (/\bspraak\s*in\b/i.test(message)) return true;
  if (/\bspreek\s+(het|dit|iets|even|kort)\b/i.test(message)) return true;
  /** o.a. "spreek in", "spreek wat in", "spreek wat in voor me …" */
  if (/\bspreek(\s+wat)?\s+in\b/i.test(message)) return true;
  if (/\bspreek\s+wat\b/i.test(t) && /\b(voor me|voor mij)\b/.test(t)) return true;
  if (/\b(inspreek|inspreken)\b/i.test(t) && /\b(voor me|voor mij|even|iets|wat)\b/.test(t))
    return true;
  if (/\bhardop\s+zeg/i.test(t)) return true;
  if (/\bvoice\s*bericht/i.test(t)) return true;
  if (/\btts\b/i.test(t)) return true;
  if (/kan\s+je\s+(dit|het)\s+zeggen/i.test(message)) return true;
  if (/kun\s+je\s+(dit|het)\s+zeggen/i.test(message)) return true;
  if (/kan\s+je\s+(wat|iets)\s+zeggen/i.test(message)) return true;
  if (/kun\s+je\s+(wat|iets)\s+zeggen/i.test(message)) return true;
  if (/kan\s+je\s+iets\s+inspreken/i.test(message)) return true;
  if (/kun\s+je\s+iets\s+inspreken/i.test(message)) return true;
  if (/\binspreek/i.test(t) && (t.includes("kan") || t.includes("kun") || t.includes("wil"))) return true;

  return false;
}
