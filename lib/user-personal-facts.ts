export type UserPersonalFacts = {
  relationshipStatus?: "single" | "in_relationship" | "complicated";
  hasGirlfriend?: boolean;
  hasKids?: boolean;
  kidsCount?: number;
  work?: string;
  birthday?: string;
  reasonOnPlatform?: string;
  interests?: string[];
  preferredInteraction?: string;
  preferredTone?: string;
  updatedAt?: string;
};

function cleanValue(v: string): string {
  return v.trim().replace(/\s+/g, " ").slice(0, 120);
}

function splitTags(raw: string): string[] {
  return raw
    .split(/,|\/| en | and /i)
    .map((x) => cleanValue(x.toLowerCase()))
    .filter((x) => x.length >= 2 && x.length <= 40)
    .slice(0, 8);
}

export function extractPersonalFactsFromText(textRaw: string): Partial<UserPersonalFacts> {
  const text = (textRaw || "").trim();
  if (!text) return {};
  const out: Partial<UserPersonalFacts> = {};

  if (
    /\b(ik heb (een )?(vriendin|vrouw)|i have (a )?(girlfriend|wife)|my girlfriend|mijn vriendin)\b/i.test(
      text
    )
  ) {
    out.relationshipStatus = "in_relationship";
    out.hasGirlfriend = true;
  } else if (/\b(single|vrijgezel|geen vriendin|ik heb niemand)\b/i.test(text)) {
    out.relationshipStatus = "single";
    out.hasGirlfriend = false;
  } else if (/\b(it's complicated|ingewikkeld|moeilijk thuis)\b/i.test(text)) {
    out.relationshipStatus = "complicated";
  }

  const kidsCountMatch = text.match(/\b(\d{1,2})\s*(kinderen|kids|children)\b/i);
  if (kidsCountMatch) {
    const n = Number(kidsCountMatch[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 20) {
      out.hasKids = n > 0;
      out.kidsCount = n;
    }
  } else if (/\b(ik heb (een )?kind(eren)?|i have (a |some )?(kid|kids|child|children))\b/i.test(text)) {
    out.hasKids = true;
  } else if (/\b(ik heb geen kinderen|i have no kids|no children)\b/i.test(text)) {
    out.hasKids = false;
    out.kidsCount = 0;
  }

  const workMatch =
    text.match(/\bik werk als\s+([^,.!\n]{2,80})/i) ||
    text.match(/\bik werk bij\s+([^,.!\n]{2,80})/i) ||
    text.match(/\bi work as\s+([^,.!\n]{2,80})/i) ||
    text.match(/\bi work at\s+([^,.!\n]{2,80})/i);
  if (workMatch?.[1]) {
    out.work = cleanValue(workMatch[1]);
  }

  const birthdayMatch =
    text.match(/\b(mijn verjaardag is|ik ben jarig op)\s+([^,.!\n]{3,60})/i) ||
    text.match(/\b(my birthday is|i was born on)\s+([^,.!\n]{3,60})/i);
  if (birthdayMatch?.[2]) {
    out.birthday = cleanValue(birthdayMatch[2]);
  }

  const reasonMatch =
    text.match(/\b(?:ik ben|i am)\s+([^,.!\n]{3,90})\s+daarom zit ik\s*(?:hier|op deze site|op dit platform)/i) ||
    text.match(/\b(?:ik zit|i am)\s*(?:hier|op deze site|op dit platform)\s*(?:omdat|because)\s+([^,.!\n]{3,90})/i) ||
    text.match(/\b(?:ik ben hier voor|i am here for)\s+([^,.!\n]{3,90})/i);
  if (reasonMatch?.[1]) {
    out.reasonOnPlatform = cleanValue(reasonMatch[1]);
  }

  const interestsMatch =
    text.match(/\b(?:ik hou van|ik vind|mijn hobbies? zijn|interesses? zijn)\s+([^.!?\n]{3,120})/i) ||
    text.match(/\b(?:i like|i love|my hobbies are|my interests are)\s+([^.!?\n]{3,120})/i);
  if (interestsMatch?.[1]) {
    const tags = splitTags(interestsMatch[1]);
    if (tags.length > 0) out.interests = tags;
  }

  const interactionMatch =
    text.match(/\b(?:ik zoek|ik wil|ik heb zin in)\s+([^.!?\n]{3,120})/i) ||
    text.match(/\b(?:i want|i am looking for|i like)\s+([^.!?\n]{3,120})/i);
  if (interactionMatch?.[1]) {
    out.preferredInteraction = cleanValue(interactionMatch[1]);
  }

  if (
    /\b(direct|recht voor z'n raap|dominant|dirty talk|expliciet|korte berichten)\b/i.test(text)
  ) {
    const toneRaw = text.match(
      /\b(direct|recht voor z'n raap|dominant|dirty talk|expliciet|korte berichten)\b/gi
    );
    if (toneRaw?.length) {
      out.preferredTone = [...new Set(toneRaw.map((x) => x.toLowerCase()))].join(", ");
    }
  }

  return out;
}

export function mergePersonalFacts(
  current: UserPersonalFacts | undefined,
  patch: Partial<UserPersonalFacts>
): UserPersonalFacts | undefined {
  const mergedInterests = Array.from(
    new Set([...(current?.interests ?? []), ...(patch.interests ?? [])].map((x) => x.toLowerCase()))
  ).slice(0, 12);

  const next: UserPersonalFacts = {
    ...(current ?? {}),
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    interests: mergedInterests.length > 0 ? mergedInterests : current?.interests,
    updatedAt: new Date().toISOString(),
  };
  const meaningful = Object.keys(next).some((k) => k !== "updatedAt");
  return meaningful ? next : current;
}

export function formatPersonalFactsForPrompt(facts: UserPersonalFacts | undefined): string {
  if (!facts) return "";
  const lines: string[] = [];
  if (facts.relationshipStatus) lines.push(`Relatiestatus: ${facts.relationshipStatus}`);
  if (typeof facts.hasGirlfriend === "boolean") {
    lines.push(`Heeft vriendin/partner: ${facts.hasGirlfriend ? "ja" : "nee"}`);
  }
  if (typeof facts.hasKids === "boolean") lines.push(`Heeft kinderen: ${facts.hasKids ? "ja" : "nee"}`);
  if (typeof facts.kidsCount === "number") lines.push(`Aantal kinderen: ${facts.kidsCount}`);
  if (facts.work) lines.push(`Werk: ${facts.work}`);
  if (facts.birthday) lines.push(`Verjaardag/geboortedatum: ${facts.birthday}`);
  if (facts.reasonOnPlatform) lines.push(`Waarom op platform: ${facts.reasonOnPlatform}`);
  if (facts.interests?.length) lines.push(`Interesses: ${facts.interests.join(", ")}`);
  if (facts.preferredInteraction) lines.push(`Gewenste interactie: ${facts.preferredInteraction}`);
  if (facts.preferredTone) lines.push(`Voorkeur toon/stijl: ${facts.preferredTone}`);
  if (lines.length === 0) return "";

  return [
    "=== USER MEMORY (hard, gebruik voor consistentie) ===",
    ...lines.map((l) => `- ${l}`),
    "Stem je toon en type vragen af op deze voorkeuren (subtiel en natuurlijk).",
    "Gebruik dit subtiel en natuurlijk (niet als checklist).",
    "=== einde user memory ===",
  ].join("\n");
}
