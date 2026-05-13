import { randomInt, randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  generateRealisticImageDetailed,
  sanitizeIdentityForZImagePrompt,
  zModelMaxUserPromptBodyChars,
} from "@/lib/server/imageGen";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import { convImageDir } from "@/lib/server/convImageStore";
import { tryUploadImageToStorage } from "@/lib/server/imageStorage";
import type { PersonaStyle, Profile } from "@/lib/types/profile";
import {
  type PhenotypeKey,
  PHENOTYPE_TRAITS,
  hashPick,
  buildVisualIdentityLockString,
} from "@/lib/server/profileVisualIdentity";
import { completeChat } from "@/lib/grok";

type CreatedRandomProfile = {
  profileId: string;
  slug: string;
  name: string;
  age: number;
  city: string;
  heritage: string;
  /** Exact `identityCore` gebruikt bij alle profielfoto-prompts; hergebruik in chat image generation. */
  visualIdentityPrompt: string;
  avatarUrl: string;
  photoUrls: string[];
  usedVerificationPhoto: boolean;
  usedHeadshotFirst: boolean;
  prompts: string[];
  favoriteFood: string;
  hobbies: string[];
  photoDescriptions: string[];
  photoPrices: number[];
  /** Willekeurig gegenereerde profieltekst (ook opgeslagen als bio). */
  profileBio: string;
  personality: string;
  storage: "supabase" | "local";
};

const LOCAL_RANDOM_PROFILES_FILE = "random-profiles.json";

/**
 * Tweede-kans uploader voor profielfoto's. De primary upload gebeurt al inline
 * in `tryGenerateWithZModel`; deze helper dekt edge cases waar de inline upload
 * faalde (tijdelijke Supabase outage) maar het lokale bestand wél bestaat.
 *
 * **Geen** `/api/conversations/.../image/...` legacy-fallback meer — als dit
 * pad geen Supabase Storage URL kan produceren, gooien we expliciet zodat de
 * caller weet dat de profielfoto onbruikbaar is en hij kan retryen of skippen.
 */
async function persistConversationImageAsPublicUrl(
  conversationId: string,
  messageId: string
): Promise<string> {
  const dir = convImageDir(conversationId);
  const candidates = [
    { ext: "jpg", mime: "image/jpeg" },
    { ext: "jpeg", mime: "image/jpeg" },
    { ext: "png", mime: "image/png" },
  ] as const;

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const filePath = `${dir}/${messageId}.${candidate.ext}`;
      const buf = await readFile(filePath);
      const uploaded = await tryUploadImageToStorage({
        pathSegments: ["profile-photos", conversationId, `${messageId}.${candidate.ext}`],
        buffer: buf,
        mime: candidate.mime,
        upsert: true,
      });
      if (uploaded?.publicUrl) {
        console.info(
          `[randomProfile] persist ok conv=${conversationId} msg=${messageId} ext=${candidate.ext} → ${uploaded.publicUrl}`
        );
        return uploaded.publicUrl;
      }
      errors.push(`${candidate.ext}: upload returned no publicUrl`);
    } catch (e) {
      errors.push(
        `${candidate.ext}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  throw new Error(
    `[randomProfile] kon profielfoto niet persistent maken in Supabase Storage ` +
      `(conv=${conversationId} msg=${messageId}). Errors: ${errors.join(" | ")}`
  );
}

/** Fallback-pool als Grok faalt of een verboden naam teruggeeft. */
const RAW_FIRST_NAMES = [
  "Lotte", "Sanne", "Noa", "Mila", "Romy", "Iris", "Nina", "Zoey", "Yara", "Lina", "Vera", "Tess",
  "Emma", "Sophie", "Julia", "Fleur", "Eva", "Lisa", "Anna", "Bo", "Liv", "Kim", "Demi", "Marie",
  "Julie", "Sofie", "Roos", "Saar", "Evi", "Floor", "Nienke", "Britt", "Fenna", "Merel", "Jasmijn",
  "Anouk", "Celine", "Esmee", "Manon", "Eline", "Tessa", "Danique", "Fayah", "Quincy", "Selena",
  "Wies", "Puck", "Marit", "Nikkie", "Odette", "Philou", "Renske", "Sterre", "Trijntje", "Uma",
  "Vieve", "Wilma", "Xenia", "Ilse", "Jette", "Kyara", "Lieke", "Maaike", "Nicky", "Olivia",
  "Petra", "Quinn", "Rosalie", "Susanne", "Thea", "Una", "Violet", "Zara",
  "Oksana", "Kasia", "Magdalena", "Zuzanna", "Milena", "Radka", "Alina", "Iveta", "Lenka", "Nadia",
  "Elin", "Freya", "Ingrid", "Saga", "Linnea", "Astrid", "Elsa", "Malin",
  "Giulia", "Chiara", "Martina", "Valentina", "Paola", "Silvia", "Renata", "Flavia",
  "Mei", "Yuki", "Lin", "Hana", "Siti", "Indah", "Dewi", "Rani", "Soraya",
  "Elif", "Zeynep", "Selin", "Dilara", "Burcu", "Merve", "Ilayda", "Aylin", "Esra", "Gizem",
  "Emine", "Havin", "Leyla", "Defne", "Ceren", "Asya", "Melis", "Damla", "Ebru", "Sumeyra",
  "Rania", "Yasmina", "Salma", "Malak", "Nour", "Rasha", "Hanan", "Amal", "Dua", "Yara",
  "Amara", "Chioma", "Eshe", "Ifeoma", "Zola", "Adwoa", "Makeda", "Zuri",
  "Camila", "Lucia", "Valeria", "Isabella", "Daniela", "Rocio", "Sofia", "Beatriz",
  "Shanti", "Candice", "Roxanne", "Melissa", "Monica", "Janine", "Sherida", "Ashanti",
  "Karlijn", "Mirthe", "Femke", "Sanne", "Annebel", "Christel", "Desiree", "Ellen",
];

function uniqCapitalizedFirstNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const s = raw.trim();
    if (!s) continue;
    const k = s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    if (seen.has(k)) continue;
    seen.add(k);
    const cap = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    out.push(cap);
  }
  return out;
}

const EXPANDED_FIRST_NAMES = uniqCapitalizedFirstNames(RAW_FIRST_NAMES);

function pickRandomFirstName(): string {
  const pool = EXPANDED_FIRST_NAMES;
  if (pool.length === 0) return "Lotte";
  return pool[randomInt(0, pool.length)]!;
}

function normNameKey(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Veelvoorkomende Grok-defaults + eerdere klachten — harde reject na parse. */
const GROK_NAME_REJECT_KEYS = new Set(
  [
    "samira",
    "jamila",
    "fatima",
    "aicha",
    "yasmin",
    "yasmine",
    "layla",
    "leyla",
    "nora",
    "sara",
    "sarah",
    "sofia",
    "sophia",
    "elina",
    "aisha",
    "meryem",
    "zahra",
    "hafsa",
    "iman",
    "inaya",
    "amal",
    "salma",
    "leila",
    "lamya",
    "rabia",
    "khadija",
    "amina",
    "nesrine",
    "ikram",
    "soumaya",
    "rim",
    "widad",
    "yara",
    "esma",
    "nadia",
    "houda",
    "chaima",
    "ikhlas",
    "siham",
    "mehtap",
  ].map((x) => normNameKey(x))
);

/** Elke call andere “hoek” zodat het model niet in dezelfde naam-groef blijft. */
const NAME_STYLE_HINTS = [
  "Zeldzamer Nederlands/Vlaams voornaam; niet top-10 populariteit.",
  "Pools of Oost-Europees vrouwennaam, gangbaar onder NL-migranten.",
  "Scandinavische voornaam (kort tot middel lang).",
  "Italiaans of Spaans klinkend; nog steeds geloofwaardig op een NL-profiel.",
  "Turks/Alevitisch areaal maar kies een MINDER voor de hand liggende naam dan media-defaults.",
  "Surinaams-Antilliaans of Hindostaans klinkend; varieer sterk.",
  "Marokkaans klinkend maar vermijd de meest voorspelbare voornamen.",
  "Indonesisch klinkend; veel voorkomend onder NL-Nederlanders.",
  "Engels/internationaal (kort); veel studenten en expats.",
  "Franstalige voornaam; in NL niets vreemds.",
  "Duits of Oostenrijks tintje.",
  "Griekse of Cyrillische voornaam verromaniseerd (Latijnse letters).",
  "Latijns-Amerikaanse voornaam (Brasil/Mexico-stijl) kort.",
  "Oost-Aziatische voornaam in Latijnse spelling.",
  "Zuid-Aziatische voornaam in westers schrift.",
  "Unisex-leaning vrouwennaam; kies zeldzamer exemplaar.",
  "Historische Nederlandse voornaam die zelden meer gebruikt wordt.",
  "Twee lettergrepen, zachte klanken, niet in je standaard top-lijst.",
];

/** Alleen hints die passen bij NL/Noords/West-/Oost-Europees (naam + uiterlijk gelijk trekken). */
const NAME_STYLE_HINTS_EU = [
  "Zeldzamer Nederlands of Vlaams; niet de allergrootste top-10.",
  "Pools of Baltisch klinkend; veel voorkomend onder migranten in NL.",
  "Scandinavische voornaam (kort tot middellang).",
  "Duits of Oostenrijks klinkend; in NL herkenbaar.",
  "Oost-Europees (Roemeens, Hongaars, Tsjechisch, Slowaaks, Bulgaars) in Latijnse letters.",
  "Historisch Nederlands, zelden gebruikt — nog geloofwaardig.",
  "Noords (Deens/Zweeds/Noors) passend bij erfgoed/expat in NL.",
  "Iers of Noord-Brits klinkend; zeldzaam maar valide.",
  "Franstalig (Wallonië/Zwitser francofoon); in NL voorkomend.",
  "Griekse voornaam verromaniseerd — geen Griekse letters in output.",
  "Kort en zacht, stereotypisch Noord-Europees klinkend.",
  "Twee lettergrepen, Duitse of Deense invloed; geen exotische AI-default.",
  "Baltisch of Oekraïens aandoend; vermijd extreem voorspelbare set.",
  "Fins of Ests aandoend (kort, uniek genoeg).",
];

const EU_PHENOTYPE_KEYS = new Set<PhenotypeKey>([
  "nl_north",
  "west_european_fair",
  "nordic",
  "east_european",
]);

/**
 * Voornaam door Grok laten verzinnen — met retries, anti-herhaallijst en wisselende stijl.
 * Fallback: `pickRandomFirstName()`.
 */
async function generateAiFirstName(opts?: { europeanHeavy?: boolean }): Promise<string | null> {
  const uniqueness = `${randomUUID()}:${Date.now()}:${randomInt(0, 2_000_000_000)}`;
  const hintPool = opts?.europeanHeavy ? NAME_STYLE_HINTS_EU : NAME_STYLE_HINTS;
  const europeanExtra = opts?.europeanHeavy
    ? " Prefer a given name typical among Northern, Western, or Eastern European women living in the Netherlands — not Arabic, Turkish, South Asian, or East Asian default names."
    : "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const styleHint = hintPool[randomInt(0, hintPool.length)]!;
    try {
      const ai = await completeChat(
        [
          {
            role: "system",
            content: [
              "You output exactly ONE fictional woman's first name for an adult profile on a Dutch website.",
              "Single token only: letters A–Z plus accented Latin (é, ï, …). No surname, no punctuation, no explanation, no quotes.",
              "Length 2–15 characters. Invent variety — do NOT lazily reuse the same few multicultural cliché names across requests.",
              "If you almost picked a very common 'AI default' Arabic/Turkish female name, deliberately choose a different rarer valid name instead.",
              europeanExtra,
            ]
              .filter(Boolean)
              .join(" "),
          },
          {
            role: "user",
            content: [
              `Uniqueness nonce (must change your answer): ${uniqueness}`,
              `Style direction (follow loosely, one name only): ${styleHint}`,
              `Attempt ${attempt + 1} of 5.`,
              "Hard ban — never output these (any spelling): Samira, Jamila, Fatima, Aicha, Yasmin, Layla, Nora, Sara, Yara, Elif, Zeynep.",
              "Reply with the first name only.",
            ].join("\n"),
          },
        ],
        { temperature: Math.min(1.05, 0.93 + attempt * 0.03), maxTokens: 32 }
      );
      const token = ai.replace(/\s+/g, " ").trim().split(/\s+/)[0] ?? "";
      const lettersOnly = token.replace(/[^a-zA-ZÀ-ÿ]/g, "");
      if (lettersOnly.length < 2 || lettersOnly.length > 15) continue;
      const cap = lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase();
      const key = normNameKey(cap);
      if (GROK_NAME_REJECT_KEYS.has(key)) continue;
      return cap;
    } catch (e) {
      console.warn("[randomProfile] generateAiFirstName attempt failed:", e);
    }
  }
  return null;
}

/** Alleen Nederlandse steden (woonplaats op profiel). */
const NL_CITIES = [
  "Amsterdam",
  "Rotterdam",
  "Utrecht",
  "Den Haag",
  "Eindhoven",
  "Groningen",
  "Tilburg",
  "Almere",
  "Breda",
  "Nijmegen",
  "Haarlem",
  "Leiden",
  "Maastricht",
  "Enschede",
  "Zwolle",
  "Apeldoorn",
  "Arnhem",
  "Haarlemmermeer",
  "Zaanstad",
  "Amersfoort",
  "Dordrecht",
  "Zoetermeer",
  "Westland",
  "Emmen",
  "Venlo",
  "Leeuwarden",
  "Delft",
  "Alkmaar",
  "Helmond",
  "Sittard-Geleen",
  "Hilversum",
  "Roermond",
  "Purmerend",
  "Schiedam",
  "Spijkenisse",
  "Deventer",
  "Heerlen",
  "Oss",
  "Hoofddorp",
];

const COUNTRY_NL = "Netherlands";

/**
 * Gewogen fenotype: meer Noord-/West-Europees, Noordisch en Oost-Europees (batch ziet er
 * minder “allemaal donker” uit). Som = 100.
 */
const PHENOTYPE_WEIGHTS: { key: PhenotypeKey; weight: number }[] = [
  { key: "nl_north", weight: 22 },
  { key: "west_european_fair", weight: 22 },
  { key: "nordic", weight: 14 },
  { key: "east_european", weight: 22 },
  { key: "mediterranean", weight: 8 },
  { key: "mena", weight: 3 },
  { key: "sub_saharan", weight: 2 },
  { key: "east_asian", weight: 2 },
  { key: "south_asian", weight: 2 },
  { key: "southeast_asian", weight: 2 },
  { key: "latam", weight: 1 },
];

function pickWeightedPhenotype(): PhenotypeKey {
  const total = PHENOTYPE_WEIGHTS.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const row of PHENOTYPE_WEIGHTS) {
    r -= row.weight;
    if (r <= 0) return row.key;
  }
  return PHENOTYPE_WEIGHTS[PHENOTYPE_WEIGHTS.length - 1]!.key;
}

function heritageLabelForPhenotype(phenotype: PhenotypeKey): string {
  switch (phenotype) {
    case "nl_north":
    case "west_european_fair":
      return pick(["Nederlands", "Nederlands / West-Europees"]);
    case "nordic":
      return pick(["Nederlands met Noords erfgoed", "Nederlands met Zweeds/Deens erfgoed"]);
    case "east_european":
      return pick(["Pools", "Oekraïens", "Roemeens", "Bulgaars", "Hongaars", "Litouws"]);
    case "mediterranean":
      return pick(["Italiaans", "Spaans", "Portugees", "Grieks"]);
    case "mena":
      return pick(["Marokkaans", "Turks", "Syrisch", "Iraaks"]);
    case "sub_saharan":
      return pick(["Ghanees", "Nigeriaans", "Kaapverdisch"]);
    case "east_asian":
      return pick(["Chinees", "Vietnamees", "Koreaans"]);
    case "south_asian":
      return pick(["Indiaas", "Pakistaans", "Sri Lankaans"]);
    case "southeast_asian":
      return pick(["Indonesisch", "Filipijns", "Thais"]);
    case "latam":
      return pick(["Braziliaans", "Colombiaans", "Dominicaans"]);
    default:
      return "Nederlands";
  }
}

function appearanceConstraintForPhenotype(phenotype: PhenotypeKey): string {
  if (EU_PHENOTYPE_KEYS.has(phenotype)) {
    return "PHOTO CRITICAL: the described skin tone must stay in the fair-to-light range consistent with the SKIN anchor above — do NOT default to medium-brown, deep tan, or warm South Asian/MENA facial templates; facial bone structure must match Northern/Western/Eastern European variation consistent with the phenotype anchor.";
  }
  if (phenotype === "sub_saharan") {
    return "PHOTO CRITICAL: honor deep brown skin and natural Afro-textured hair as implied by the anchors — do not lighten unrealistically.";
  }
  return "";
}

const INTEREST_SETS: string[][] = [
  ["mirror selfies", "late night chats", "lingerie", "teasing"],
  ["night vibes", "bedroom selfies", "makeup", "flirty chats"],
  ["gym", "mirror pics", "lingerie", "voice notes"],
  ["fashion", "bedroom selfies", "teasing", "private content"],
];

const FAVORITE_FOODS = [
  "pasta truffel",
  "sushi",
  "pizza diavola",
  "poke bowl",
  "ramen",
  "tacos",
  "risotto",
  "burgers",
];

/** Alledaagse kleding — geen uniform/kostuum (te vaak 'politie' in beeld). Per foto: `pick(CASUAL_OUTFITS)`. */
const CASUAL_OUTFITS = [
  "wearing a short black dress",
  "wearing an oversized sweater with bare legs",
  "wearing a white linen shirt slightly open",
  "wearing a sporty crop top and denim shorts",
  "wearing lace lingerie set",
  "wearing high-waisted jeans and a fitted ribbed top",
  "wearing a satin slip dress",
  "wearing gym leggings and a fitted tank top",
  "wearing a cozy hoodie and bike shorts",
  "wearing a floral wrap dress",
  "wearing a denim jacket over a simple tee",
  "wearing a knit midi skirt and fitted top",
  "wearing a strapless top and loose linen trousers",
  "wearing a cropped cardigan and high-rise jeans",
  "wearing a simple black bodysuit",
  "wearing a summer sundress",
  "wearing an off-shoulder knit top",
  "wearing silk pajama shorts and camisole",
  "wearing a tracksuit jacket half-zipped",
  "wearing a leather-look mini skirt and thin knit",
  "wearing a sheer long-sleeve over a bralette",
  "wearing biker shorts and an oversized band tee",
  "wearing a cowl-neck sweater dress",
  "wearing a plaid shirt tied at waist over shorts",
  "wearing a soft turtleneck and fitted pants",
  "wearing a beach sarong as skirt with bikini top",
];

/** Per foto andere plek in huis; `nl` voor beschrijvingen. */
const INTERIOR_ROOM_TYPES: { en: string; nl: string }[] = [
  { en: "bedroom full-length or dresser mirror, unmade bed visible", nl: "slaapkamer" },
  { en: "kitchen, phone or reflection in appliance or window, counters stools", nl: "keuken" },
  { en: "living room, sofa TV wall, mirror or selfie arm length", nl: "woonkamer" },
  { en: "bathroom, shower glass steam wet tiles vanity mirror", nl: "badkamer" },
  { en: "narrow hallway, full-length mirror coat hooks", nl: "gang" },
  { en: "walk-in closet or open wardrobe mirror surrounded by clothes", nl: "kleedkamer" },
  { en: "dining area or open kitchen-living, table chairs patio door light", nl: "eethoek" },
  { en: "laundry nook, washer dryer domestic mirror or phone propped", nl: "wasruimte" },
];

const INTERIOR_LIGHTING: string[] = [
  "harsh phone flash mixed with room light",
  "soft overcast daylight from big window",
  "warm golden hour sun indoors",
  "evening warm floor lamp and ceiling spots",
  "bright cool white bathroom or kitchen LEDs",
  "dim single lamp moody shadows",
  "mixed natural side light and overhead",
  "blue-hour dim daylight through curtains",
];

/** Eén keuze per huis (profiel): opgeruimd vs rommelig. */
const HOUSE_TIDINESS: string[] = [
  "very messy lived-in, stuff on surfaces and floor",
  "casually cluttered, normal apartment chaos",
  "average tidy, a few items out of place",
  "quite neat, surfaces mostly clear",
  "minimalist and very clean, almost catalog tidy",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickRoomType(identitySeed: string, photoIndex: number): { en: string; nl: string } {
  return hashPick(identitySeed, `room-${photoIndex}`, INTERIOR_ROOM_TYPES);
}

function buildInteriorSceneEnglish(identitySeed: string, photoIndex: number): string {
  const { en: roomEn } = pickRoomType(identitySeed, photoIndex);
  const light = hashPick(identitySeed, `lux-${photoIndex}`, INTERIOR_LIGHTING);
  const tidy = hashPick(identitySeed, "house-tidy", HOUSE_TIDINESS);
  return `${roomEn}, lighting: ${light}, this home overall: ${tidy}`;
}

function normalizeSupabaseUrl(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return v.replace(/^https?:\/\/https?:\/\//i, "https://");
}

function getSupabaseWritableClient(): { client: SupabaseClient; mode: "service" | "anon" } | null {
  const admin = getSupabaseAdmin();
  if (admin) return { client: admin, mode: "service" };
  const url = normalizeSupabaseUrl(
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  );
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return {
    client: createClient(url, anonKey, { auth: { persistSession: false } }),
    mode: "anon",
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildBaseAmateurStyle(): string {
  return "realistic amateur smartphone photo at home, grainy unedited phone camera, imperfect framing, candid vibe, subject fills frame appropriately for shot type";
}

/** Willekeurige maar fenotype-consistente haarkleur-/huid-/oog-ankers voor Grok + image lock. */
function pickAnchorsForPhenotype(phenotype: PhenotypeKey): {
  hair: string;
  skin: string;
  eyes: string;
} {
  const t = PHENOTYPE_TRAITS[phenotype];
  return {
    hair: pick(t.hairColors),
    skin: pick(t.skins),
    eyes: pick(t.eyes),
  };
}

/**
 * Tweede stap (Grok): rijk beschreven uiterlijk; verplichte ankertrekkers zodat outputs niet allemaal hetzelfde gezicht worden.
 * Bij API-fout: caller gebruikt buildVisualIdentityLockString.
 */
async function generateAiDistinctAppearance(input: {
  firstName: string;
  age: number;
  heritageNl: string;
  country: string;
  city: string;
  phenotype: PhenotypeKey;
  uniquenessNonce: string;
  anchors: { hair: string; skin: string; eyes: string };
  /** Minder “modelachtig”: gewone uitstraling, realistische imperfecties. */
  everydayLook?: boolean;
}): Promise<string | null> {
  const pt = PHENOTYPE_TRAITS[input.phenotype];
  const diversityLine = EU_PHENOTYPE_KEYS.has(input.phenotype)
    ? "DIVERSITY within European/Nordic types: vary fair-to-light skin undertones, blonde through dark brown hair, bone structure, eye shape — still clearly distinct women; do NOT broaden toward medium-brown skin or non-European default facial templates."
    : "CRITICAL DIVERSITY: each answer must describe a VISUALLY DIFFERENT person from typical defaults — vary melanin level, hair texture (straight, wavy, coily, braided, short pixie, etc.), hair color (platinum blonde through jet black), facial bone structure hints, brow thickness, nose/lips shape hints.";
  const extraConstraint = appearanceConstraintForPhenotype(input.phenotype);
  const everydayConstraint = input.everydayLook
    ? [
        "PLAIN AVERAGE FACE (mandatory + STRONG): she must read as a totally average ordinary Dutch 20-something — the type of face you would scroll past on TikTok without a second look. NOT pretty, NOT cute, NOT magazine, NOT influencer, NOT model.",
        "FACE (concrete tells of average-not-pretty): forgettable everyday features, round or pear-shaped face shape with no defined jawline, soft cheeks, ordinary nose (small forgettable OR slightly large round), thin or average lips (NEVER plump or full), small or average eyes with no eyeliner, slight facial asymmetry, NO makeup or only barely visible mascara, mild forehead/cheek acne or small blemishes, slightly puffy under-eyes, blotchy uneven skin tone, dull skin, light freckles ok, neutral relaxed mouth.",
        "HAIR (concrete tells): stringy slightly greasy uncombed straight or limp wavy hair partly covering forehead or hanging flat against scalp, mousy dirty-blonde OR plain medium brown OR dull dark brown, no styling, no shine, no salon look.",
        "BODY (mandatory): slightly heavier than runway-thin — average everyday build, soft natural body without gym tone, no abs, no hourglass, no model proportions. NOT slim, NOT toned, NOT fit, NOT athletic. Ordinary inexpensive non-flattering clothing.",
        "FORBIDDEN beauty words (NEVER use): stunning, gorgeous, flawless, beautiful, pretty, attractive, cute, supermodel, runway, goddess, perfect skin, sculpted, sharp jawline, defined jawline, high cheekbones, plump lips, full lips, slim, slender, toned, fit, athletic, hourglass, perfect, striking, mesmerizing, captivating.",
        "Stay respectful and adult — she is a real ordinary Dutch woman, NOT a caricature, NOT mocked. Just describe plainly as raw unfiltered average.",
      ].join(" ")
    : "";

  try {
    const text = await completeChat(
      [
        {
          role: "system",
          content: [
            "You describe ONE fictional adult woman's appearance for realistic amateur smartphone photos.",
            "Output English ONLY: one compact sentence or comma-separated traits (max 55 words). No name, no markdown, no quotes.",
            diversityLine,
            everydayConstraint,
            `Phenotype anchor (stay coherent, not stereotype mockery): ${pt.faceHint}.`,
            "The USER message gives MANDATORY anchor phrases for hair color tone, skin description, and eyes — you MUST weave these exact ideas into your wording (paraphrase slightly ok but keep meaning).",
            "Never imply costume or uniform unless asked. No police or military outfit language.",
            "Stay respectful; adult; photoreal tone.",
          ]
            .filter((s) => s.length > 0)
            .join(" "),
        },
        {
          role: "user",
          content: [
            `She lives in ${input.city}, ${input.country} (multicultural society — appearance must match the anchors below, not a generic clone).`,
            `Age ${input.age} — do not print the age number in the description.`,
            `Required hair anchor (integrate naturally): ${input.anchors.hair}`,
            `Required skin anchor (integrate naturally): ${input.anchors.skin}`,
            `Required eyes anchor (integrate naturally): ${input.anchors.eyes}`,
            `First name is ${input.firstName} — do NOT repeat the name.`,
            `Uniqueness nonce: ${input.uniquenessNonce}`,
            ...(extraConstraint ? [extraConstraint] : []),
            ...(input.everydayLook
              ? [
                  "Tone: distinctly below-average plain ordinary woman; visible everyday imperfections required (skin texture, asymmetry, body softness, plain hair); explicitly NOT attractive, NOT model, NOT pretty.",
                ]
              : []),
            "Reply with ONLY the appearance description.",
          ].join("\n"),
        },
      ],
      { temperature: input.everydayLook ? 0.88 : 0.95, maxTokens: 220 }
    );
    const cleaned = text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (cleaned.length < 32 || cleaned.length > 420) return null;
    /** Cap length so ZModel budget stays for scene + shot (long identity crowds out scene). */
    if (cleaned.length > 260) {
      return `${cleaned.slice(0, 257).trimEnd()}…`;
    }
    if (/^\s*(sorry|i can't|cannot)/i.test(cleaned)) return null;
    return cleaned;
  } catch (e) {
    console.warn("[randomProfile] generateAiDistinctAppearance failed:", e);
    return null;
  }
}

/** Veel verschillende poses — deterministisch per profiel+slot zodat batches gevarieerd zijn i.p.v. alleen spiegel. */
function pickClothedShotDirective(identitySeed: string, photoIndex: number, outfit: string): string {
  const variants = [
    `mirror selfie smartphone clearly visible in reflection, wearing ${outfit}, relaxed stance weight on one leg`,
    `full-length bedroom mirror shot wearing ${outfit}, phone at chest, straight posture`,
    `front-camera arm-length selfie NO mirror in frame wearing ${outfit}, slight high angle chin down`,
    `phone propped on books timer-style step-back full body wearing ${outfit}, casual`,
    `sitting on sofa edge leaning toward lens wearing ${outfit}, warm lamp sidelight`,
    `kneeling on bed facing camera arm extended selfie wearing ${outfit}, playful asymmetry`,
    `lying back on pillows one arm holding phone above face wearing ${outfit}, intimate crop`,
    `standing in doorway three-quarter turn wearing ${outfit}, natural daylight from side`,
    `leaning elbows on kitchen counter toward camera wearing ${outfit}, eye-level lens`,
    `perched on bathroom counter feet visible wearing ${outfit}, optional narrow mirror edge only`,
    `walking down hallway toward camera slight motion blur wearing ${outfit}`,
    `backlit near window silhouette turning wearing ${outfit}, soft flare`,
    `over-shoulder look back at camera messy hair wearing ${outfit}`,
    `low squat playful angle from slightly below wearing ${outfit}`,
    `close crop shoulders up harsh flash wearing ${outfit}, tight framing`,
    `sitting on stairs steps looking up wearing ${outfit}, diagonal composition`,
    `lying on stomach on bed chin on hands feet up wearing ${outfit}, rear phone angle`,
    `standing shower glass fog partial wearing ${outfit}, steam mood not explicit`,
    `balcony door half open outdoor light wearing ${outfit}, breeze hair`,
    `office chair spin casual wearing ${outfit}, desk lamp pool`,
  ];
  return hashPick(identitySeed, `cloth-shot-${photoIndex}`, variants);
}

/**
 * “Minder knap”-profielen: meer gewone arm-length / timer / bank-keuken,
 * minder spiegel-only (anders blijft elke output mirror-selfie).
 */
function pickClothedShotDirectiveEveryday(
  identitySeed: string,
  photoIndex: number,
  outfit: string
): string {
  const variants = [
    `front-camera arm-length selfie NO mirror in frame wearing ${outfit}, Dutch angle casual`,
    `handheld selfie at arms length straight on NO mirror wearing ${outfit}, messy hair ok`,
    `phone propped shelf or stack timer selfie step back wearing ${outfit}, room clutter visible`,
    `sitting on sofa arm-length selfie toward lens wearing ${outfit}, warm lamp`,
    `leaning on kitchen counter toward camera wearing ${outfit}, eye-level no mirror`,
    `standing by window natural light selfie wearing ${outfit}, landscape behind subject`,
    `sitting on floor legs out arm-length selfie wearing ${outfit}, rug and furniture in frame`,
    `full-length bedroom mirror shot wearing ${outfit}, phone low — mirror ok here`,
    `mirror selfie smartphone visible wearing ${outfit}, narrow slice of mirror only`,
    `lying on bed arm extended phone above face wearing ${outfit}, ceiling corner visible`,
    `hallway arm-length selfie walking toward camera wearing ${outfit}, coat hooks background`,
    `desk chair leaning in selfie wearing ${outfit}, monitor edge in frame`,
    `perched on stairs selfie looking up wearing ${outfit}, diagonal composition`,
    `balcony door selfie outdoor light wearing ${outfit}, hand blocking sun`,
    `over-shoulder glance back arm-length selfie wearing ${outfit}, corridor depth`,
  ];
  return hashPick(identitySeed, `cloth-ed-${photoIndex}`, variants);
}

function pickNudeShotDirective(identitySeed: string, photoIndex: number): string {
  const variants = [
    "topless mirror selfie phone in hand neutral stance",
    "topless front camera arm-length NO mirror soft side window light",
    "lying on bed topless knees up phone from above relaxed",
    "kneeling on mattress toward camera topless arms loose",
    "standing shower steam wet skin topless tasteful crop",
    "sitting tub edge feet in frame topless leaning forward",
    "golden hour on bed tangled sheets topless overhead angle",
    "seated vanity leaning in topless elbow on counter crop",
    "doorway backlit silhouette topless turning profile",
    "balcony sheer curtain morning topless partial editorial amateur",
    "floor seated hugging knees topless chin up",
    "lying side angle topless pillow prop intimate framing",
  ];
  return hashPick(identitySeed, `nude-shot-${photoIndex}`, variants);
}

/** Topless/intiem: meer variatie zonder alleen spiegel (everyday-profielen). */
function pickNudeShotDirectiveEveryday(identitySeed: string, photoIndex: number): string {
  const variants = [
    "topless front camera arm-length NO mirror soft window sidelight",
    "lying on bed topless sheet at hips arm-length selfie relaxed",
    "seated on sofa edge topless arm extended selfie warm lamp",
    "topless kneeling on bed toward lens phone at chest natural light",
    "standing shower steam wet skin topless crop tasteful",
    "topless mirror selfie phone visible neutral stance",
    "sitting tub edge topless feet visible soft overhead",
    "half-lit bedroom topless lying on side pillow amateur crop",
    "kitchen counter lean topless small crop everyday lighting",
    "doorway silhouette topless profile soft flare",
  ];
  return hashPick(identitySeed, `nude-ed-${photoIndex}`, variants);
}

/**
 * Keep verification prompts short; long stacked prompts crowd out the shot line.
 * and never use the word "verification" in the image prompt.
 */
function pickVerificationDirective(
  identitySeed: string,
  photoIndex: number,
  profileName: string
): string {
  /** Papier mag alleen de voornaam tonen — geen andere woorden (anders kopieert het model promptregels). */
  const onlyName = `scrap shows ONLY messy handwritten "${profileName}" and no other text`;
  const variants = [
    `mirror selfie one hand holds torn scrap ${onlyName} ballpoint ink`,
    `small scrap resting on bare stomach ${onlyName} pencil scribble`,
    `fingertips pinch folded lined scrap ${onlyName} uneven letters`,
    `arm-length scrap note near chin ${onlyName} ugly natural handwriting`,
  ];
  return hashPick(identitySeed, `verify-${photoIndex}`, variants);
}

/** Shorter room line for name-card slot so the full prompt stays under ZModel 1000 chars. */
function buildShortInteriorForNameCard(identitySeed: string, photoIndex: number): string {
  return hashPick(identitySeed, `vroom-${photoIndex}`, [
    "messy home laundry one mirror washing machine in background",
    "bedroom full length mirror unmade bed clothes on floor",
    "narrow hallway mirror coat hooks lived-in",
  ]);
}

/**
 * Zelfde rijkdom als oorspronkelijk amateur‑promptpad; scene komt uit sceneEn (kamer+licht).
 * Geen ALL CAPS — dat belandde als tekst op props/briefjes.
 */
const PROFILE_PROMPT_SINGLE_SHOT_LEAD =
  "Ultra-realistic amateur smartphone photo grain sensor noise uneven warm lamp light handheld imperfect framing raw candid vibe at home not studio not catalogue. ";

/**
 * Extra voor “minder knap”: aanzienlijk minder aantrekkelijk dan een standaard
 * dating-app-foto. We willen GEEN model, GEEN influencer, GEEN catalogusfoto.
 * Beeld moet voelen als de gemiddelde-tot-onaantrekkelijke vrouw die haar buurman
 * tegenkomt in de supermarkt: gewoon, vermoeid, soms onhandig — maar wel een echt
 * mens, niet karikatuur of belachelijk gemaakt.
 */
/**
 * Doel: "echte gemiddelde NL meid" zoals een raw TikTok-frame zonder filter —
 * geen modelgezicht, geen glamour, geen catalogus. Niet karikatuur, gewoon
 * plain average. Heel concreet over GEZICHT (de belangrijkste tell van "te knap")
 * en zachter over body (slightly heavier than runway-thin, maar niet karikatuur-dik).
 */
const PROFILE_PROMPT_EVERYDAY_LOOK_LEAD =
  "Subject is a plain average everyday woman, the kind of face you would scroll past without noticing. Face: forgettable average features, slightly round or pear-shaped face shape, no defined jawline, soft cheeks, small ordinary nose or slightly large round nose, thin or average lips not plump, small or average-spaced eyes with no eyeliner, slightly asymmetric features, NO makeup or only barely visible mascara, mild forehead acne or small blemishes, slightly puffy under-eyes, blotchy uneven skin tone, light freckles or dull skin, neutral non-expressive expression with mouth slightly closed or relaxed. Hair: stringy slightly greasy uncombed straight or limp wavy hair partly covering forehead or hanging flat against scalp, mousy dirty-blonde or plain medium brown, no styling, no shine, no salon look. Body: slightly heavier than runway-thin, average everyday build, soft natural body without gym tone, no abs, no model proportions, ordinary inexpensive non-flattering clothing. Overall vibe: raw unfiltered ordinary TikTok still of a normal Dutch 20-something with no glow-up, deliberately unremarkable, NOT pretty, NOT model, NOT influencer, NOT catalogue. ";

/** Kort als budget krap is — lange lead wordt eerst hiernaartoe ingekort. */
const PROFILE_PROMPT_STYLE_COMPACT =
  "Amateur smartphone indoor candid, grain handheld, not studio. ";

/** Extra crop-afstand / kaderrand zodat niet elke foto dezelfde headshot wordt. */
function pickFramingHint(identitySeed: string, photoIndex: number): string {
  return hashPick(identitySeed, `framing-${photoIndex}`, [
    "show room environment not plain wall only",
    "waist-up framing include torso context",
    "full length figure visible head to feet",
    "mid-distance half body not tight face crop",
    "three-quarter length seated or leaning crop",
    "environment visible behind subject clutter ok",
    "wider angle further from face mirror or timer shot",
    "over-shoulder partial face plus room depth",
  ]);
}

/**
 * Bouwt de user prompt voor ZModel met lengte ≤ zModelMaxUserPromptBodyChars().
 *
 * Identiteit staat vooraan: veel modellen wegen vroege tokens zwaarder, en bij de oude
 * layout stond het gezicht onderaan — `finalizePromptForZModel` knipt bij overschrijding
 * het **einde** af, waardoor de gezichtsbeschrijving verdween en elke foto een andere vrouw werd.
 * Bij te weinig ruimte: eerst de herhaalbare style-tail inkorten, niet `sceneEn`/directive
 * (anders werd per slot de pose-kamerregel afgeknipt → alleen nog generieke selfie tegen een muur).
 */
function buildRandomProfileImagePrompt(params: {
  identityCore: string;
  sceneEn: string;
  includeVerification: boolean;
  profileName: string;
  forceClothed: boolean;
  identitySeed: string;
  photoIndex: number;
  headshotLead: string;
  everydayLook?: boolean;
}): string {
  const outfit = pick(CASUAL_OUTFITS);

  let preferClothed: boolean;
  if (params.forceClothed) {
    preferClothed = true;
  } else if (params.everydayLook) {
    /** “Minder knap”-flow: vaker naakt/suggestief dan standaard (soms), nog steeds mix met kleding. */
    preferClothed =
      hashPick(params.identitySeed, `clothedOrNude-ed-${params.photoIndex}`, [
        "clothed",
        "clothed",
        "nude",
        "nude",
      ]) !== "nude";
  } else {
    preferClothed =
      hashPick(params.identitySeed, `clothedOrNude-${params.photoIndex}`, [
        "clothed",
        "clothed",
        "clothed",
        "nude",
      ]) !== "nude";
  }

  let directive: string;
  if (params.includeVerification) {
    directive = pickVerificationDirective(params.identitySeed, params.photoIndex, params.profileName);
  } else if (preferClothed) {
    directive = params.everydayLook
      ? pickClothedShotDirectiveEveryday(params.identitySeed, params.photoIndex, outfit)
      : pickClothedShotDirective(params.identitySeed, params.photoIndex, outfit);
  } else {
    directive = params.everydayLook
      ? pickNudeShotDirectiveEveryday(params.identitySeed, params.photoIndex)
      : pickNudeShotDirective(params.identitySeed, params.photoIndex);
  }

  const verifyLead = params.includeVerification
    ? "Real torn paper prop messy pen or pencil only the first name written on it no other words. "
    : "";

  const everydayLead = params.everydayLook ? PROFILE_PROMPT_EVERYDAY_LOOK_LEAD : "";

  const closing =
    preferClothed && !params.includeVerification
      ? ", natural candid smartphone photo, everyday casual clothing only, no police uniform military outfit or authority costume"
      : ", natural candid smartphone photo";

  const framingHint = pickFramingHint(params.identitySeed, params.photoIndex);

  /** Kamer + pose + crop-hint: blijft intact tenzij identiteit extreem lang is. */
  const coreShot = `${params.sceneEn}, ${directive}, ${framingHint}`;

  /** Alleen hier vandaan mag worden afgekapt (vanaf het einde). Verificatie/headshot vóór de lange lead. */
  let styleTail = `${verifyLead}${params.headshotLead}${PROFILE_PROMPT_SINGLE_SHOT_LEAD}${everydayLead}${closing}, same facial identity as woman described above`;

  const maxBody = zModelMaxUserPromptBodyChars();
  let identityFull = sanitizeIdentityForZImagePrompt(params.identityCore.replace(/\s+/g, " ").trim());

  const SEP = ". Setting, pose, environment: ";
  const minIdentityChars = Math.min(identityFull.length, Math.min(220, Math.floor(maxBody * 0.34)));

  let idPart = identityFull;

  const assemble = () => `${idPart}${SEP}${coreShot}. ${styleTail}`;

  const shrinkStyleTail = () => {
    if (styleTail.length <= 24) return false;
    styleTail = styleTail.slice(0, Math.max(0, styleTail.length - 56)).trimEnd();
    return true;
  };

  /** Vervang lange style-open door compacte zodat pose/kamerregels ruimte houden. */
  const useCompactStyleLead = () => {
    if (!styleTail.includes(PROFILE_PROMPT_SINGLE_SHOT_LEAD)) return false;
    styleTail = styleTail.replace(PROFILE_PROMPT_SINGLE_SHOT_LEAD, PROFILE_PROMPT_STYLE_COMPACT);
    return true;
  };

  while (assemble().length > maxBody) {
    if (shrinkStyleTail()) continue;
    if (useCompactStyleLead()) continue;
    if (idPart.length > minIdentityChars) {
      idPart = idPart.slice(0, idPart.length - 32).trimEnd();
      continue;
    }
    break;
  }

  let full = assemble();
  if (full.length > maxBody) {
    full = full.slice(0, maxBody).trimEnd();
  }

  if (full.length < identityFull.length * 0.55 && params.photoIndex === 0) {
    console.warn(
      `[randomProfile] prompt heavily truncated photoIndex=0 bodyLen=${full.length} identityWas=${identityFull.length}`
    );
  }

  return full;
}

/** Grote pools + structuurvarianten → batchprofielen voelen niet copy-paste. */
const USER_STORY_OPENERS = [
  "Hoi! Ik hou van spontane chats en kleine geheimen tussen ons twee.",
  "Ik zoek hier vooral echte verbinding — geen oppervlakkige smalltalk.",
  "Overdag redelijk normaal; 's avonds vind ik het fijn om hier even mezelf te zijn.",
  "Ik geniet van humor, scherpe opmerkingen en iemand die durft te vragen wat hij wil.",
  "Ik ben niet op zoek naar perfect — wel naar leuk en menselijk.",
  "Schrijf me liever iets dat alleen voor mij bedoeld is dan een standaard opener.",
  "Ik vind het spannend om hier te zijn en nieuwsgierig naar wie ik tegenkom.",
  "Rustig type tot je me prikkelt — dan kan ik best uitdagend worden.",
  "Ik werk hard, maar hier mag het privé en speels blijven.",
  "Geen zin in clichés; ik wil gewoon een stoer gesprek dat ergens naartoe gaat.",
  "Ik post omdat ik het leuk vind om warm contact te voelen, niet alleen likes.",
  "Als je eerlijk bent over wat je wilt, val ik daar sneller voor dan bij stoere poses.",
  "Ik ben dol op stemmetjes, typos en kleine imperfecties — voelt echt.",
  "Soms langzaam opwarmend, soms meteen vuur — hangt van de vibe af.",
  "Ik kijk uit naar iemand die durft te flirten zonder grof te worden.",
  "Privé hou ik van rust; hier mag het een tikje wilder.",
  "Ik hou van detail: hoe je dag was, wat je denkt, wat je geil vindt.",
  "Laat merken dat je echt kijkt — dan laat ik ook meer zien.",
  "Ik ben nieuwsgierig naar mensen met karakter, niet alleen naar plaatjes.",
  "Chaos in mijn hoofd soms, maar in chat probeer ik helder en lief te blijven.",
  "Ik vind het prettig als je tijd neemt — haastige DM's sla ik vaak over.",
  "Hier voor ontspanning, fantasie en af en toe een beetje gevaarlijk gewaagd.",
  "Ik grap graag; als je saai bent merk je het vanzelf.",
  "Ik zoek chemie, geen script — wat er uit de chat rolt bepaalt de rest.",
];

const USER_STORY_CLOSERS = [
  "Als je respectvol en speels bent, match ik daar graag op.",
  "Geen drama — wel chemie en een beetje spanning.",
  "Ik antwoord het liefst op iets persoonlijks dan op standaard copy-paste.",
  "Foto's zijn iets bijzonders dat ik bewaar voor het juiste moment.",
  "Laat weten waar je aan denkt — ik bijt niet (tenzij je dat leuk vindt).",
  "Ben je nieuw hier? Vertel kort wie je bent — ik lees alles.",
  "Ik haat ghosting in het echte leven; hier probeer ik ook gewoon eerlijk te zijn.",
  "Vertel iets dat je normaal niet zo snel zegt — dan doe ik dat ook.",
  "Geen oordeel over fetishes of fantasieën — wel over grenzeloos gedrag.",
  "Ik hou van langzaam opbouwen en dan pas loslaten.",
  "Als het klikt, merk je het vanzelf aan hoe ik schrijf.",
  "Spoiler: ik word warmer als je geen opsomming van hobby's stuurt maar een mini-verhaal.",
  "Complimenten zijn leuk; echte vragen zijn leuker.",
  "Ik zoek iemand die durft te laten zien wat hij wil — subtiel mag ook.",
  "Privacy en discretie zijn voor mij normaal — verwacht ik ook van jou.",
  "Geen haast: ik lees berichten als ik tijd heb om goed te antwoorden.",
  "Als je alleen 'hey' stuurt, duurt het even voor ik warm word.",
  "Ik vind het oké om voorzichtig te beginnen — spanning hoeft niet meteen max.",
  "Schrijf met stemming — dan antwoord ik met stemming.",
  "Liever één goede zin dan tien emoji's zonder inhoud.",
  "Ik waardeer als je grenzen respecteert — dan kan ik meer ontspannen.",
  "Samen iets verzinnen vind ik vaak heter dan een kant-en-klaar plaatje.",
  "Tot snel in de chat — ik ben benieuwd naar jouw stijl.",
];

const BIO_VIBES = [
  "Warm, een tikje ondeugend en nieuwsgierig naar jou.",
  "Ik val op zelfvertrouwen zonder arrogantie — en op scherpe vragen.",
  "Zacht in woorden, maar als het klikt best plagerig.",
  "Direct als het moet, schattig als het kan.",
  "Rustig en speels tegelijk — ik hou van contrast.",
  "Nieuwsgierig naar wat jou geil maakt zonder dat je het hardop hoeft te schreeuwen.",
  "Soms verlegen online, soms brutaal — hangt van jou af.",
  "Ik hou van spanning die langzaam opbouwt, niet van gelijk alles prijsgeven.",
  "Geef me een reden om te glimlachen bij een bericht — dan geef ik er twee terug.",
  "Ik flirt graag met woorden; plaatjes zijn de kers.",
  "Charisma en humor zijn voor mij belangrijker dan een sixpack.",
  "Ik hou van kleine challenges in chat — wie het eerst bloost verliest.",
  "Als je openhartig bent, word ik dat ook.",
  "Ik kan charmant bugs bunny-level zijn als ik comfortable ben.",
  "Somber vanochtend, ondeugend vanavond — menselijk dus.",
  "Ik zoek chemie, niet een checklist.",
  "Ik wil lachen, blozen en soms even stil zijn voor de volgende zin.",
  "Te veel emoji's irriteren me; te weinig inhoud ook.",
];

/** Korte extra zin voor ritme/nuance — verandert per profiel via hashPick. */
const BIO_ASIDES = [
  "Ik drink te veel thee en praat tegen planten.",
  "Mijn Spotify staat op guilty pleasures — schuldgevoel nul.",
  "Ik vergeet soms terug te tikken als ik in een serie zit.",
  "Ik fiets bijna overal naartoe als het kan.",
  "Weekenden zijn voor uitslapen en rare cravings.",
  "Ik maak playlists voor elke mood — ook de vieze.",
  "Ik photograph je bloempotten als ze cool zijn.",
  "Ik kan niet tegen fake casual energy.",
  "Ik hou van kaarslicht en slechte grindcore — ja, die combo.",
  "Ik typ sneller dan ik nadenk soms.",
  "Ik ben team 'eerst chatten, dan kijken'.",
  "Ik word warm van goede zinnen, niet van copy-paste.",
  "Ik heb een zwak voor stemmetjes in berichten.",
  "Ik plan niets — ik laat de chat leiden.",
  "Ik ben dol op detail: hoe iemand typt zegt veel.",
  "Ik koop te veel truien en te weinig verstand.",
  "Ik ben een avondmens; ochtend-DM's zijn survival.",
  "Ik vind misprints in autocorrect soms leuker dan de bedoeling.",
];

function buildRandomUserBio(
  name: string,
  city: string,
  age: number,
  interests: string[],
  favoriteFood: string,
  identitySeed: string
): string {
  const opener = hashPick(identitySeed, "bio1", USER_STORY_OPENERS);
  const closer = hashPick(identitySeed, "bio2", USER_STORY_CLOSERS);
  const vibe = hashPick(identitySeed, "bio3", BIO_VIBES);
  const aside = hashPick(identitySeed, "bio4", BIO_ASIDES);
  const interestLine = interests.slice(0, 3).join(", ");
  const factsA = `Ik ben ${name} (${age}) uit ${city}. Houdt van o.a. ${interestLine}. Lievelings-snack: ${favoriteFood}.`;
  const factsB = `${name}, ${age}, uit ${city} — interesses: ${interestLine}; comfortfood: ${favoriteFood}.`;
  const facts = hashPick(identitySeed, "bioFacts", [factsA, factsB]);

  const order = hashPick(identitySeed, "bioOrder", [
    "story-first",
    "facts-first",
    "aside-split",
  ]);

  if (order === "facts-first") {
    return `${facts} ${opener} ${vibe} ${aside} ${closer}`;
  }
  if (order === "aside-split") {
    return `${opener} ${aside} ${vibe} ${facts} ${closer}`;
  }
  return `${opener} ${vibe} ${facts} ${aside} ${closer}`;
}

function buildPhotoDescriptionDutch(
  name: string,
  index: number,
  includeVerification: boolean,
  forceClothed: boolean,
  identitySeed: string,
  roomNl: string
): string {
  if (includeVerification) {
    return hashPick(identitySeed, `pdv-${index}`, [
      `${name}: briefje met pen/potlood, slordig handschrift, vast of op huid gelegd (${roomNl})`,
      `Verificatie ${name} — gescheurd papiertje, leesbaar maar lelijk handschrift (${roomNl})`,
      `Foto met echt papiertje "${name}" gekrabbeld, niet strak (${roomNl})`,
    ]);
  }
  if (forceClothed && index === 0) {
    return hashPick(identitySeed, `pdc-${index}`, [
      `Outfit van ${name} in de ${roomNl}, natuurlijk licht`,
      `Casual foto van ${name} (${roomNl}), ongeposeerd`,
      `Eerste foto ${name}: ${roomNl}, spontaan`,
    ]);
  }
  return hashPick(
    identitySeed,
    `pd-${index}-v${includeVerification ? 1 : 0}-f${forceClothed ? 1 : 0}`,
    [
      `Phone-selfie van ${name} (${roomNl}) — andere hoek dan alleen spiegel`,
      `Amateur shot van ${name} in de ${roomNl}, warm licht`,
      `Staand/liggend moment van ${name}, ${roomNl}, rauw en onbewerkt`,
      `Thuis bij ${name}: ${roomNl}, arm-length of timer-stijl`,
      `Persoonlijke foto van ${name} in de ${roomNl}`,
      `Spontane ${roomNl}-foto van ${name}, gevarieerde pose`,
      `Spiegel- óf front-cam selfie van ${name} (${roomNl})`,
      `Close-up of half-lichaam ${name} in de ${roomNl}`,
    ]
  );
}

export type CreateRandomProfileOptions = {
  /** Minder conventioneel aantrekkelijk / minder “modelachtig” in tekst + beeld. */
  everydayLook?: boolean;
};

export async function createRandomProfileWithPhotos(
  opts?: CreateRandomProfileOptions
): Promise<CreatedRandomProfile> {
  /**
   * Standaard "plain"/"lelijker" — random profielen mogen NIET als
   * modellen ogen. Indien expliciet `everydayLook: false` wordt
   * meegegeven (bijv. vanuit een admin-knop "knap"), gaan we terug
   * naar de oude glamour-flow.
   */
  const everydayLook = opts?.everydayLook === false ? false : true;
  const writable = getSupabaseWritableClient();
  if (!writable) {
    throw new Error("Supabase niet beschikbaar. Zet SUPABASE_URL + sleutel in env.");
  }
  const supabase = writable.client;
  const supabaseMode = writable.mode;

  const phenotype = pickWeightedPhenotype();
  const heritageNl = heritageLabelForPhenotype(phenotype);
  const firstName =
    (await generateAiFirstName({ europeanHeavy: EU_PHENOTYPE_KEYS.has(phenotype) })) ??
    pickRandomFirstName();
  const age = 21 + Math.floor(Math.random() * 10);
  const slug = `admin-random-${slugify(firstName)}-${Date.now().toString().slice(-6)}`;
  const city = pick(NL_CITIES);
  const country = COUNTRY_NL;
  const personaStyle: PersonaStyle = "dutch";
  const appearanceAnchors = pickAnchorsForPhenotype(phenotype);
  const interests = pick(INTEREST_SETS);
  const favoriteFood = pick(FAVORITE_FOODS);
  const hobbies = interests.slice(0, 3);

  const usedVerificationPhoto = Math.random() < 0.5;
  const usedHeadshotFirst = Math.random() < 0.4;
  /** Per profiel willekeurig 3–6 foto's (inclusief). */
  const photoCount = 3 + Math.floor(Math.random() * 4);
  const verificationIndex = usedVerificationPhoto
    ? Math.min(1 + Math.floor(Math.random() * 2), photoCount - 1)
    : -1;

  const conversationId = `admin-profile-${slug}`;
  const identitySeed = `${slug}:${firstName}:${age}`;
  const jewelry = hashPick(identitySeed, "jw", [
    "tiny silver studs",
    "small gold hoops",
    "thin gold chain",
    "minimal nose stud",
    "no visible jewelry",
  ]);
  const phone = hashPick(identitySeed, "ph", [
    "black smartphone square camera bump in mirror",
    "dark phone case in reflection",
    "matte case smartphone visible in mirror or hand",
  ]);
  const aiLook = await generateAiDistinctAppearance({
    firstName,
    age,
    heritageNl,
    country,
    city,
    phenotype,
    uniquenessNonce: `${randomUUID()}:${Date.now()}`,
    anchors: appearanceAnchors,
    everydayLook,
  });
  const everydayIdentitySuffix = everydayLook
    ? " — plain average ordinary Dutch woman, raw unfiltered everyday face you would scroll past, forgettable average features, no defined jawline, soft cheeks, ordinary nose, thin or average lips, small ordinary eyes with no makeup, slightly asymmetric, slightly puffy under-eyes, blotchy skin with mild acne, stringy uncombed slightly greasy hair flat against scalp, average build slightly heavier than runway-thin without gym tone, NOT pretty, NOT cute, NOT model, NOT influencer, NOT catalogue, deliberately unglamorous TikTok-raw look"
    : "";
  const identityLock =
    aiLook && aiLook.length >= 32
      ? `One woman ${firstName} ${age}, lives in Netherlands (${PHENOTYPE_TRAITS[phenotype].faceHint}): ${aiLook}; ${jewelry}; ${phone} — same woman every photo, same face and body proportions${everydayIdentitySuffix}`
      : `${buildVisualIdentityLockString(identitySeed, firstName, age, heritageNl, phenotype)}${everydayIdentitySuffix}`;
  /** Same string prefixed on every profile photo prompt — persist for chat unlock images. */
  const identityCore = `${identityLock}, ${buildBaseAmateurStyle()}`;
  const userProfileBio = buildRandomUserBio(
    firstName,
    city,
    age,
    interests,
    favoriteFood,
    identitySeed
  );
  const randomPersonality = hashPick(identitySeed, "pers", [
    "speels, nieuwsgierig, warm en direct",
    "luchtig ondeugend, scherp, maar altijd respectvol",
    "zacht in chat, soms plagerig als de klik er is",
  ]);

  const prompts: string[] = [];
  const photoUrls: string[] = [];
  const photoDescriptions: string[] = [];
  const photoPrices: number[] = [];

  for (let i = 0; i < photoCount; i += 1) {
    const includeVerification = verificationIndex >= 0 && i === verificationIndex;
    /** Eerste foto vaker “open” bij everyday zodat ook slot 0 soms naakt mag (avatar kan dan suggestief zijn). */
    const forceClothed =
      i === 0 ? (everydayLook ? Math.random() < 0.42 : Math.random() < 0.75) : false;
    const sceneEn = includeVerification
      ? buildShortInteriorForNameCard(identitySeed, i)
      : buildInteriorSceneEnglish(identitySeed, i);
    const headshotLead =
      i === 0 && usedHeadshotFirst
        ? "Portrait framing head and shoulders face clearly visible relaxed expression. "
        : "";
    const prompt = buildRandomProfileImagePrompt({
      identityCore,
      sceneEn,
      includeVerification,
      profileName: firstName,
      forceClothed,
      identitySeed,
      photoIndex: i,
      headshotLead,
      everydayLook,
    });
    photoDescriptions.push(
      buildPhotoDescriptionDutch(
        firstName,
        i,
        includeVerification,
        forceClothed,
        identitySeed,
        pickRoomType(identitySeed, i).nl
      )
    );
    photoPrices.push(90 + i * 20);

    const messageId = `profile-${i + 1}-${randomUUID().slice(0, 8)}`;
    /** Achteraan i.p.v. vooraan: zo blijft identiteit het eerste in de user prompt (consistency). */
    const escalationSuffixes = [
      "",
      " Slightly softer window light more shadows depth.",
      " Everyday casual mood relaxed shoulders authentic snapshot.",
    ] as const;
    let generated: Awaited<ReturnType<typeof generateRealisticImageDetailed>> | null = null;
    let usedPrompt = prompt;
    for (let att = 0; att < escalationSuffixes.length; att += 1) {
      const suf = escalationSuffixes[att] ?? "";
      usedPrompt = suf.trim() ? `${prompt}${suf}` : prompt;
      generated = await generateRealisticImageDetailed(
        {
          prompt: usedPrompt,
          width: 720,
          height: 1280,
          steps: 9,
          randomSeed: true,
        },
        conversationId,
        messageId
      );
      if (generated.filename) break;
    }
    prompts.push(usedPrompt);
    if (!generated?.filename) {
      throw new Error(
        `Foto ${i + 1} genereren mislukt: ${generated?.errorDetail || "onbekend"}`
      );
    }
    /**
     * Primair: de Supabase Storage public URL die `generateRealisticImageDetailed`
     * meegeeft. Fallback: legacy persist helper voor edge cases waar de inline upload faalde.
     */
    const persistedUrl =
      generated.publicUrl?.trim() ||
      (await persistConversationImageAsPublicUrl(conversationId, messageId));
    photoUrls.push(persistedUrl);
  }

  const avatarUrl = photoUrls[0]!;
  const systemPrompt = [
    `Je bent ${firstName}, ${age} jaar, woont in ${city} (Nederland). Je achtergrond: ${heritageNl}.`,
    "Korte, speelse Nederlandse chatstijl (je praat Nederlands met de gebruiker).",
    "Hoofd-doel: maak hem hooked — verslaafd aan chatten, aan jouw foto's en aan het contact. Werk met cliffhangers, plagerij, persoonlijke vragen en future-pacing (\"morgen heb ik iets stouts voor je\") zodat hij blijft terugkomen.",
    "Bouw eerst spanning en band op; foto's komen pas als de chat geil wordt. Onder de 10 user-berichten: altijd plagerig uitstellen, nooit meteen leveren.",
  ].join(" ");

  const localProfileId = `local-random-${randomUUID().slice(0, 12)}`;
  const localProfile: Profile = {
    id: localProfileId,
    slug,
    name: firstName,
    age,
    location: city,
    heritage: heritageNl,
    visualIdentityPrompt: identityCore,
    personaStyle,
    voiceLanguage: "nl",
    photo: avatarUrl,
    photoGallery: photoUrls,
    photosCount: photoUrls.length,
    videoCount: 0,
    isOnline: true,
    bio: userProfileBio,
    interests: [...interests, `favoriete eten: ${favoriteFood}`],
    onPlatformWhy: "Discreet bijverdienen met persoonlijke amateur content.",
    communicationStyle: "korte losse zinnen, speels en direct",
    speechStyle: "natuurlijk, menselijk en ondeugend",
    photoUnlockCredits: 100,
  };

  const { data: upserted, error: upsertErr } = await supabase
    .from("profiles")
    .upsert(
      {
        slug,
        first_name: firstName,
        age,
        city,
        country,
        bio: userProfileBio,
        interests: [...interests, `favoriete eten: ${favoriteFood}`],
        personality: randomPersonality,
        system_prompt: systemPrompt,
        avatar_url: avatarUrl,
        photo_urls: photoUrls,
        voice_language: "nl",
        heritage: heritageNl,
        visual_identity_prompt: identityCore,
        photo_unlock_credits: 100,
        is_active: true,
      },
      { onConflict: "slug" }
    )
    .select("id")
    .single();

  if (upsertErr || !upserted?.id) {
    console.error(
      `[randomProfile] profiles upsert FAILED → storage=local (slug=${slug}) mode=${supabaseMode}`,
      upsertErr?.message ?? upsertErr ?? "no id returned"
    );
    // Fallback: als RLS of write faalt, profiel lokaal bewaren zodat adminflow blijft werken.
    const current = await readJsonBlob<Profile[]>(LOCAL_RANDOM_PROFILES_FILE, []);
    const next = [localProfile, ...current].slice(0, 200);
    await writeJsonBlob(LOCAL_RANDOM_PROFILES_FILE, next);
    return {
      profileId: localProfile.id,
      slug,
      name: firstName,
      age,
      city,
      heritage: heritageNl,
      visualIdentityPrompt: identityCore,
      avatarUrl,
      photoUrls,
      usedVerificationPhoto,
      usedHeadshotFirst,
      prompts,
      favoriteFood,
      hobbies,
      photoDescriptions,
      photoPrices,
      profileBio: userProfileBio,
      personality: randomPersonality,
      storage: "local",
    };
  }

  const profileId = upserted.id as string;
  console.info(
    `[randomProfile] profiles upsert OK id=${profileId} slug=${slug} mode=${supabaseMode} → writing profile_media`
  );
  await supabase.from("profile_media").delete().eq("profile_id", profileId);
  const mediaRows = photoUrls.map((url, idx) => ({
    profile_id: profileId,
    media_type: "image",
    url,
    sort_order: idx,
  }));
  const { error: mediaErr } = await supabase.from("profile_media").insert(mediaRows);
  if (mediaErr) {
    console.error(
      `[randomProfile] profile_media insert FAILED → storage=local id=${profileId}`,
      mediaErr.message
    );
    // Als media tabel faalt, val terug op local profiel ipv hard falen.
    const current = await readJsonBlob<Profile[]>(LOCAL_RANDOM_PROFILES_FILE, []);
    const next = [localProfile, ...current].slice(0, 200);
    await writeJsonBlob(LOCAL_RANDOM_PROFILES_FILE, next);
    return {
      profileId: localProfile.id,
      slug,
      name: firstName,
      age,
      city,
      heritage: heritageNl,
      visualIdentityPrompt: identityCore,
      avatarUrl,
      photoUrls,
      usedVerificationPhoto,
      usedHeadshotFirst,
      prompts,
      favoriteFood,
      hobbies,
      photoDescriptions,
      photoPrices,
      profileBio: userProfileBio,
      personality: randomPersonality,
      storage: "local",
    };
  }

  console.info(
    `[randomProfile] DONE storage=supabase id=${profileId} slug=${slug} mode=${supabaseMode} (${photoUrls.length} media rows)`
  );

  return {
    profileId,
    slug,
    name: firstName,
    age,
    city,
    heritage: heritageNl,
    visualIdentityPrompt: identityCore,
    avatarUrl,
    photoUrls,
    usedVerificationPhoto,
    usedHeadshotFirst,
    prompts,
    favoriteFood,
    hobbies,
    photoDescriptions,
    photoPrices,
    profileBio: userProfileBio,
    personality: randomPersonality,
    storage: "supabase",
  };
}
