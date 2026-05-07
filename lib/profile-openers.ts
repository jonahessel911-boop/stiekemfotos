import type { Profile } from "@/lib/types/profile";

function firstName(full: string): string {
  const p = full.trim().split(/\s+/)[0];
  return p || full;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Vier korte openers (NL) op basis van profiel — snel, geen LLM nodig.
 * API-route kan dit later uitbreiden met xAI indien gewenst.
 */
export function buildProfileOpeners(profile: Profile): string[] {
  const name = firstName(profile.name);
  const interests = (profile.interests ?? []).map(norm).filter(Boolean);
  const bio = norm(profile.bio ?? "");
  const blob = [...interests, bio].join(" ");

  const out: string[] = [];

  const push = (s: string) => {
    const t = s.trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };

  if (blob.includes("dans") || blob.includes("salsa") || blob.includes("bachata") || blob.includes("latin")) {
    push(`Hé ${name}, hoe lang dans je al? 💃`);
    push(`Salsa of bachata? 😏`);
  }
  if (blob.includes("sport") || blob.includes("fitness") || blob.includes("gym")) {
    push(`Hé ${name}, wat is jouw favoriete work-out? 💪`);
  }
  if (blob.includes("reizen") || blob.includes("travel") || blob.includes("stad")) {
    push(`Waar zou je het liefst nu naartoe gaan? ✈️`);
  }
  if (blob.includes("muziek") || blob.includes("festival")) {
    push(`Welke muziek draait bij jou op repeat? 🎵`);
  }
  if (blob.includes("koffie") || blob.includes("wijn") || blob.includes("eten")) {
    push(`Koffie of wijn-date — wat kies jij? ☕`);
  }

  push(`Knipoog terug 😉`);
  push(`Wat brengt je hier?`);
  push(`Hé ${name}, je profiel sprak me aan — hoe is je avond? ✨`);
  push(`Ben je meer serieus of meer voor de lol hier? 😊`);
  push(`Waar woon je ongeveer? 📍`);

  return out.slice(0, 4);
}
