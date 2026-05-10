/** NL = standaard NL-persona; east_european = warme Oost-Europese chatstijl + voiceLanguage voor TTS. */
export type PersonaStyle = "dutch" | "east_european";

export interface Profile {
  id: string;
  /** Supabase slug; gebruikt voor stabiele image-identity (zelfde als profielfoto-seed). */
  slug?: string;
  name: string;
  age: number;
  location: string;
  /** Lichaamskenmerken (optioneel voor profielkaart/filtering). */
  lengte?: number;
  gewicht?: number;
  cupMaat?: string;
  /** Woont in NL; heritage = herkomst voor persona (bijv. "Oekraïne"). */
  heritage?: string;
  /**
   * Exacte visuele referentie zoals bij profielfoto-generatie (Engels).
   * Gezet bij admin "random user"; chat image generation gebruikt dit i.p.v. alleen hash-based identity.
   */
  visualIdentityPrompt?: string;
  personaStyle: PersonaStyle;
  /** xAI TTS: nl | ru | uk | pl | ro | bg, etc. */
  voiceLanguage: string;
  photo: string;
  /** Credits needed to unlock one generated photo for this profile. */
  photoUnlockCredits?: number;
  /** Optioneel: extra foto-URL’s (bijv. uit Supabase) voor feed/galerij. */
  photoGallery?: string[];
  photosCount: number;
  videoCount?: number;
  isOnline: boolean;
  bio: string;
  interests: string[];
  /** Waarom ze discreet op het platform zit (motivatie, discretie). */
  onPlatformWhy?: string;
  /** Hoe ze typt: toon, tempo, stijl (voor de AI). */
  communicationStyle?: string;
  /** Hoe ze klinkt bij spraak / TTS-beschrijving. */
  speechStyle?: string;
}
