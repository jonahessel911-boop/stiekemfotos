import { createHash } from "crypto";
import type { Profile } from "@/lib/types/profile";

export type PhenotypeKey =
  | "nl_north"
  | "west_european_fair"
  | "nordic"
  | "east_european"
  | "mediterranean"
  | "mena"
  | "sub_saharan"
  | "east_asian"
  | "south_asian"
  | "southeast_asian"
  | "latam";

export const PHENOTYPE_TRAITS: Record<
  PhenotypeKey,
  { hairColors: string[]; skins: string[]; eyes: string[]; faceHint: string }
> = {
  nl_north: {
    hairColors: [
      "dark blonde",
      "strawberry blonde",
      "ash blonde",
      "light brown",
      "medium brown natural Dutch",
      "dirty blonde",
    ],
    skins: [
      "very fair skin cool undertone",
      "fair skin pink undertone typical Dutch",
      "light porcelain skin",
      "fair with subtle freckles northern Europe",
    ],
    eyes: [
      "bright blue eyes",
      "grey-blue eyes",
      "green-grey eyes",
      "light green eyes",
      "soft brown eyes northern European",
    ],
    faceHint:
      "Northern European Dutch facial features, not Hispanic not Latin American not Mediterranean tan",
  },
  west_european_fair: {
    hairColors: ["light brown", "dark blonde", "chestnut brown", "dark brown", "auburn"],
    skins: ["fair skin", "light beige skin", "fair neutral undertone"],
    eyes: ["blue eyes", "green eyes", "hazel eyes", "brown eyes"],
    faceHint: "Western European appearance",
  },
  nordic: {
    hairColors: ["platinum blonde", "ash blonde", "strawberry blonde", "light brown"],
    skins: ["very fair skin", "pale skin cool undertone", "fair with light freckles"],
    eyes: ["blue eyes", "grey eyes", "green eyes"],
    faceHint: "Scandinavian Nordic features",
  },
  east_european: {
    hairColors: ["dark brown", "chestnut", "black brown", "dark blonde", "auburn"],
    skins: ["fair to light olive skin", "light beige eastern European"],
    eyes: ["blue eyes", "green eyes", "grey eyes", "brown eyes"],
    faceHint: "Eastern European Slavic features",
  },
  mediterranean: {
    hairColors: ["dark brown", "black brown", "warm brown", "chestnut"],
    skins: ["olive skin", "light tan Mediterranean", "warm beige skin"],
    eyes: ["dark brown eyes", "hazel brown eyes", "green-brown eyes"],
    faceHint: "Southern European Mediterranean features",
  },
  mena: {
    hairColors: ["dark brown", "black hair", "warm brown"],
    skins: ["olive skin", "light brown skin", "warm medium skin"],
    eyes: ["dark brown eyes", "brown eyes", "hazel eyes"],
    faceHint: "Middle Eastern North African features",
  },
  sub_saharan: {
    hairColors: ["black hair", "dark brown natural hair", "braided dark hair"],
    skins: ["deep brown skin", "rich brown skin", "dark skin glow"],
    eyes: ["dark brown eyes", "brown eyes"],
    faceHint: "Sub-Saharan African features",
  },
  east_asian: {
    hairColors: ["natural black hair", "dark brown Asian hair", "jet black straight hair"],
    skins: [
      "light East Asian skin tone",
      "fair East Asian complexion",
      "warm light skin East Asian",
    ],
    eyes: ["dark brown almond eyes", "brown monolid or double eyelid natural"],
    faceHint: "East Asian facial features",
  },
  south_asian: {
    hairColors: ["black hair", "very dark brown hair"],
    skins: [
      "light brown South Asian skin",
      "medium brown skin warm undertone",
      "tan South Asian complexion",
    ],
    eyes: ["dark brown eyes", "deep brown eyes"],
    faceHint: "South Asian features",
  },
  southeast_asian: {
    hairColors: ["black hair", "dark brown hair"],
    skins: ["tan Southeast Asian skin", "light brown warm skin", "golden undertone skin"],
    eyes: ["dark brown eyes", "brown eyes"],
    faceHint: "Southeast Asian features",
  },
  latam: {
    hairColors: ["dark brown", "black hair", "warm brown", "chestnut"],
    skins: ["tan skin", "light brown Latin skin", "olive tan skin", "warm medium skin"],
    eyes: ["dark brown eyes", "brown eyes", "hazel eyes"],
    faceHint: "Latin American features",
  },
};

function normHeritage(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

/**
 * Leidt fenotype af uit DB-veld heritage / land (NL + EN keywords).
 * Zelfde mapping als bij random profielen → chat-foto's matchen visueel met kaart-foto's.
 */
export function inferPhenotypeFromHeritage(heritageRaw?: string | null): PhenotypeKey {
  const h = normHeritage(heritageRaw ?? "");
  if (!h) return "west_european_fair";

  if (
    /nederland|nederlands|dutch|holland|netherlands|nl\b/.test(h) ||
    h === "nl"
  ) {
    return "nl_north";
  }
  if (/zweed|swed|norway|noors|noorwegen|denmark|deens|finland|finse|iceland|ijsland/.test(h)) {
    return "nordic";
  }
  if (
    /pool|polish|polen|ukrain|oekrai|roemen|romanian|bulgar|slowak|tsjech|hongaar|kroat|servisch|slavic|oost-europe/.test(
      h
    )
  ) {
    return "east_european";
  }
  if (/spaans|spanish|italiaan|italian|portugees|portugal|grieks|greek|mediterr/.test(h)) {
    return "mediterranean";
  }
  if (/turk|marokko|morocco|egypt|arab|syria|libanon|liban|tunisia|alger|iran|iraq|mena|midden.?oosten/.test(h)) {
    return "mena";
  }
  if (/nigeria|kenya|ghana|senegal|ethiop|south africa|zuid-afrika|afrika(?!ans)|suriname|subafrican/.test(h)) {
    return "sub_saharan";
  }
  if (/japan|chinese|china|korea|koreaans|taiwan|hong kong|mongol/.test(h)) {
    return "east_asian";
  }
  if (/india|indian|pakistan|bangladesh|sri lanka|nepal|south asian/.test(h)) {
    return "south_asian";
  }
  if (/indones|vietnam|thai|philippijn|filipijn|malaysia|singapore|thailand|aziatisch zuidoost/.test(h)) {
    return "southeast_asian";
  }
  if (/brazil|brasil|mexico|mexico|colombia|argent|chile|peru|latijns|latina|latino|carib/.test(h)) {
    return "latam";
  }
  if (/belg|german|duits|france|frans|brit|uk|engeland|ireland|ijsland|amerika|canada|canadees|austral|zeeland nieuw/.test(h)) {
    return "west_european_fair";
  }

  return "west_european_fair";
}

export function hashPick<T>(seed: string, salt: string, arr: T[]): T {
  const hex = createHash("sha256").update(`${seed}:${salt}`).digest("hex");
  const n = Number.parseInt(hex.slice(0, 8), 16);
  return arr[n % arr.length]!;
}

/**
 * Zelfde logica als profiel-foto generatie: stabiel per profiel via identitySeed.
 */
export function buildVisualIdentityLockString(
  identitySeed: string,
  name: string,
  age: number,
  heritageLabel: string,
  phenotype: PhenotypeKey
): string {
  const t = PHENOTYPE_TRAITS[phenotype];
  const hairColor = hashPick(identitySeed, "hc", t.hairColors);
  const hairStyle = hashPick(identitySeed, "hs", [
    "long loose waves",
    "long straight with soft ends",
    "mid-length layered cut",
    "short pixie cut",
    "shoulder-length natural curls",
    "long box braids",
    "sleek low ponytail",
    "messy bun with face-framing strands",
    "very long straight middle part",
    "chin-length bob",
    "afro texture natural volume",
    "waist-length braided crown",
  ]);
  const skin = hashPick(identitySeed, "sk", t.skins);
  const eyes = hashPick(identitySeed, "ey", t.eyes);
  const build = hashPick(identitySeed, "bd", [
    "slim hourglass",
    "slender athletic",
    "petite slim",
    "soft curvy",
    "tall broad-shouldered lean",
    "compact muscular legs",
  ]);
  const phone = hashPick(identitySeed, "ph", [
    "black smartphone square camera bump in mirror",
    "dark phone case in reflection",
  ]);
  const jewelry = hashPick(identitySeed, "jw", [
    "tiny silver studs",
    "small gold hoops",
    "thin gold chain",
  ]);

  return `One woman ${name} ${age}, heritage ${heritageLabel} (${t.faceHint}): ${hairColor} ${hairStyle} hair, ${skin}, ${eyes}, ${build}, ${jewelry}, ${phone} — same person as her profile avatar photo, identical facial structure and body proportions; one candid uncropped snapshot filling the frame edge to edge`;
}

/**
 * Voor chat + unlock: deterministisch op profiel-id zodat elke gegenereerde foto dezelfde "Lotte" is als op de profielkaart.
 */
export function buildStableVisualIdentityForProfile(profile: Profile): string {
  const heritageLabel = (profile.heritage || "Nederlands").trim() || "Nederlands";
  const phenotype = inferPhenotypeFromHeritage(profile.heritage);
  /** Matcht randomProfileFactory: seed op slug zodat chat-foto's = profielfoto's. */
  const identitySeed =
    profile.slug && profile.slug.trim().length > 0
      ? `${profile.slug.trim()}:${profile.name}:${profile.age}`
      : `${profile.id}:${profile.name}:${profile.age}`;
  return buildVisualIdentityLockString(
    identitySeed,
    profile.name,
    profile.age,
    heritageLabel,
    phenotype
  );
}
