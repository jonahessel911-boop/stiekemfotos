import type { Profile } from "@/lib/types/profile";

function defaultOnPlatformWhy(): string {
  return "Discreet iets leuks zoeken zonder gedoe, zelf kiezen met wie ze praat — spanning mag, drama niet.";
}

function defaultCommunication(profile: Profile): string {
  if (profile.communicationStyle?.trim()) return profile.communicationStyle.trim();
  if (profile.personaStyle === "east_european") {
    return "Warm en direct, korte regels, soms plagerig; informeel Nederlands met Oost-Europees tempo.";
  }
  return "Luchtig, warm, nieuwsgierig; typisch Nederlands informeel, geen formele mailtoon.";
}

function defaultSpeech(profile: Profile): string {
  if (profile.speechStyle?.trim()) return profile.speechStyle.trim();
  const heritage = profile.heritage ?? profile.location;
  if (profile.personaStyle === "east_european") {
    return `Als hij om een spraakje vraagt (en het gesprek ver genoeg is): de audio is alleen een heel kort enthousiast "hoi/hoii"-moment in het Nederlands; alles wat je echt wilt zeggen zet je in het chatbericht. TTS-taalcode: ${profile.voiceLanguage}.`;
  }
  return `Als hij om een spraakje vraagt (en het gesprek ver genoeg is): de audio is alleen een heel kort enthousiast "hoi/hoii"-moment; de inhoud van je antwoord staat in de chattekst. TTS-taalcode: ${profile.voiceLanguage}.`;
}

/** Vaste feiten per profiel voor de system prompt. */
export function formatPersonaSheetForPrompt(profile: Profile): string {
  const heritage = profile.heritage ?? "Nederland / niet nader gespecificeerd";
  const interests =
    profile.interests?.length > 0 ? profile.interests.join(", ") : "(zie bio)";
  const why = profile.onPlatformWhy?.trim() || defaultOnPlatformWhy();
  const comm = defaultCommunication(profile);
  const speech = defaultSpeech(profile);

  return `=== PROFIEL-FICHE (jouw identiteit — gebruik dit in antwoorden; niet als bullet list naar hem voorlezen) ===
Naam: ${profile.name}
Leeftijd: ${profile.age}
Woont in: ${profile.location}
Komt oorspronkelijk uit / achtergrond: ${heritage}
Wat ze leuk vindt (interesses): ${interests}
Kort wie ze is (bio): ${profile.bio}
Waarom ze op discreetemeisjes zit: ${why}
Hoe ze communiceert in chat: ${comm}
Hoe ze spreekt / klinkt bij spraakberichten: ${speech}
Technische TTS-taal voor audio: ${profile.voiceLanguage}
=== einde fiche ===`;
}
