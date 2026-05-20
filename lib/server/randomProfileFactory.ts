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

/** Fallback-pool als Grok faalt of een verboden naam teruggeeft (mannen). */
const RAW_FIRST_NAMES = [
  "Daan", "Lucas", "Sem", "Milan", "Levi", "Finn", "Noah", "Lars", "Tim", "Tom", "Max", "Sam",
  "Jesse", "Ruben", "Thijs", "Bram", "Stijn", "Jordy", "Kevin", "Mike", "Rick", "Nick", "Bas",
  "Mark", "Paul", "Peter", "Jan", "Martijn", "Dennis", "Roy", "Patrick", "Sander", "Robin",
  "Koen", "Niels", "Wesley", "Glenn", "Dylan", "Jayden", "Tygo", "Gijs", "Floris", "Hidde",
  "Mats", "Cas", "Boaz", "Teun", "Olivier", "Victor", "Alex", "Chris", "David", "Daniel",
  "Adam", "Kamil", "Piotr", "Jakub", "Mateusz", "Tomasz", "Ivan", "Dmitri", "Andrei", "Viktor",
  "Marco", "Luca", "Matteo", "Diego", "Carlos", "Hugo", "Pablo", "Rafael", "Antonio",
  "Yusuf", "Emre", "Can", "Burak", "Mehmet", "Ali", "Omar", "Karim", "Rayan", "Samir",
  "Jamal", "Kwame", "Kofi", "Malik", "Tariq", "Nabil", "Hassan", "Ibrahim",
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
  if (pool.length === 0) return "Daan";
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
  "Pools of Oost-Europees mannennaam, gangbaar onder NL-migranten.",
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
  "Korte mannennaam; kies zeldzamer exemplaar.",
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
    ? " Prefer a given name typical among Northern, Western, or Eastern European men living in the Netherlands — not Arabic, Turkish, South Asian, or East Asian default names."
    : "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const styleHint = hintPool[randomInt(0, hintPool.length)]!;
    try {
      const ai = await completeChat(
        [
          {
            role: "system",
            content: [
              "You output exactly ONE fictional man's first name for an adult profile on a Dutch website.",
              "Single token only: letters A–Z plus accented Latin (é, ï, …). No surname, no punctuation, no explanation, no quotes.",
              "Length 2–15 characters. Invent variety — do NOT lazily reuse the same few multicultural cliché names across requests.",
              "If you almost picked a very common 'AI default' name, deliberately choose a different rarer valid Dutch/European male name instead.",
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
 * Veel gelijker verdeeld voor échte etnische diversiteit binnen een batch.
 * Som = 100. Geen enkel fenotype dominant; alle hoofdgroepen ~6-13%.
 */
const PHENOTYPE_WEIGHTS: { key: PhenotypeKey; weight: number }[] = [
  { key: "nl_north", weight: 13 },
  { key: "west_european_fair", weight: 12 },
  { key: "nordic", weight: 9 },
  { key: "east_european", weight: 12 },
  { key: "mediterranean", weight: 11 },
  { key: "mena", weight: 9 },
  { key: "sub_saharan", weight: 9 },
  { key: "east_asian", weight: 8 },
  { key: "south_asian", weight: 7 },
  { key: "southeast_asian", weight: 6 },
  { key: "latam", weight: 4 },
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
  ["voetbal", "gaming", "fitness", "late night chats"],
  ["gym", "mirror selfies", "muziek", "flirten"],
  ["festivals", "uitgaan", "snapchat", "sport"],
  ["koken", "series", "wandelen", "discreet chatten"],
  ["skaten", "sneakers", "tattoos", "privé gesprekken"],
  ["hardlopen", "bier", "weekend weg", "nieuwe mensen"],
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

/** Outfit per foto — echt random, veel types jonge mannen. */
function pickMaleOutfitRandom(): string {
  const category = pickWeighted([
    { weight: 14, value: "hoodie_hood" as const },
    { weight: 10, value: "hoodie_down" as const },
    { weight: 12, value: "street" as const },
    { weight: 8, value: "gym" as const },
    { weight: 10, value: "home" as const },
    { weight: 6, value: "smart" as const },
    { weight: 8, value: "outdoor" as const },
    { weight: 8, value: "skater" as const },
    { weight: 6, value: "work" as const },
    { weight: 8, value: "summer" as const },
    { weight: 10, value: "night" as const },
    { weight: 10, value: "oversized" as const },
  ]);
  const pools: Record<string, string[]> = {
    hoodie_hood: [
      "wearing a black hoodie with hood up over head, face partly in shadow",
      "wearing grey oversized hoodie hood up, only lower face visible",
      "wearing navy zip hoodie hood up, casual indoor",
      "wearing dark green hoodie capuchon on, slouching on couch",
      "wearing worn black hoodie hood up, mirror selfie at home",
    ],
    hoodie_down: [
      "wearing a black hoodie hood down and joggers",
      "wearing a cozy grey hoodie and sweatpants",
      "wearing an oversized band hoodie and shorts",
    ],
    street: [
      "wearing slim jeans and a fitted tee",
      "wearing an oversized band tee and shorts",
      "wearing a denim jacket over a simple tee",
      "wearing a leather jacket and dark jeans",
      "wearing a flannel shirt open over a tee",
    ],
    gym: [
      "wearing gym shorts and a muscle tee",
      "wearing a fitted tank top and gym shorts",
      "wearing a zip-up track jacket and joggers",
      "wearing a tracksuit jacket half-zipped",
    ],
    home: [
      "wearing a plain grey t-shirt and jeans",
      "wearing pajama pants and no shirt",
      "wearing sweatpants only shirtless",
      "wearing a soft turtleneck and fitted pants",
    ],
    smart: [
      "wearing chinos and a polo shirt",
      "wearing a white linen shirt unbuttoned at collar",
      "wearing a satin shirt half open",
      "wearing loose linen trousers and a tee",
    ],
    outdoor: [
      "wearing a puffer jacket and jeans outdoors",
      "wearing a rain jacket hood down, urban background",
      "wearing swim trunks only at beach",
    ],
    skater: [
      "wearing baggy jeans and a graphic tee",
      "wearing cargo pants and a beanie",
      "wearing cap backwards and a hoodie hood down",
    ],
    work: [
      "wearing a simple black t-shirt and chinos",
      "wearing a plaid shirt and chino shorts",
    ],
    summer: [
      "wearing shorts and a loose tank top",
      "wearing linen shirt sleeves rolled up",
    ],
    night: [
      "wearing a black tee and joggers dim lamp light",
      "wearing hoodie hood up in dim bedroom light",
    ],
    oversized: [
      "wearing oversized grey hoodie and baggy sweatpants",
      "wearing XXXL band tee hanging loose over belly",
      "wearing loose basketball shorts and tank, relaxed fit",
    ],
  };
  return pick(pools[category] ?? pools.street);
}

/** Per foto andere plek in huis; `nl` voor beschrijvingen. */
const INTERIOR_ROOM_TYPES: { en: string; nl: string }[] = [
  { en: "bedroom with unmade bed, clothes on floor, cluttered nightstand", nl: "slaapkamer" },
  { en: "kitchen with counters and stools, fridge and oven visible", nl: "keuken" },
  { en: "living room with sofa and TV wall, coffee table with stuff on it", nl: "woonkamer" },
  { en: "bathroom with sink and toiletries, towels on hook", nl: "badkamer" },
  { en: "narrow hallway with coat hooks and shoes on the floor", nl: "gang" },
  { en: "walk-in closet or open wardrobe filled with clothes", nl: "kleedkamer" },
  { en: "dining area with table and chairs, patio door light", nl: "eethoek" },
  { en: "laundry nook with washer and dryer, basket of clothes", nl: "wasruimte" },
  // --- Outdoor / varia scenes voor meer variatie ---
  { en: "wet inside the shower, water on skin, tiled walls", nl: "douche" },
  { en: "outdoor sandy beach on a sunny day, sea and sky in background, towel on the sand", nl: "strand" },
  { en: "swimming pool edge, sun loungers, blue tiles in background", nl: "zwembad" },
  { en: "small balcony on a city apartment, plants and railing, urban rooftops behind", nl: "balkon" },
  { en: "city park grass with trees in background, sunny afternoon", nl: "park" },
  { en: "sauna wooden interior, warm dim light, towel around waist", nl: "sauna" },
  { en: "hotel room with bed and curtains, hotel-style lamps", nl: "hotelkamer" },
  { en: "car driver seat, seatbelt visible, dashboard behind", nl: "auto" },
  { en: "small home gym corner, yoga mat, dumbbells on the floor", nl: "thuisgym" },
  { en: "small home office desk corner, laptop and notebook visible, soft daylight", nl: "thuiswerkplek" },
  { en: "bathtub full of water and bubbles, candles on the rim", nl: "ligbad" },
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

function pickWeighted<T>(items: Array<{ weight: number; value: T }>): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1]!.value;
}

/** Willekeurige kamer per foto (niet altijd dezelfde hash-volgorde). */
function pickRoomTypeRandom(): { en: string; nl: string } {
  return pick(INTERIOR_ROOM_TYPES);
}

function buildInteriorSceneEnglishRandom(): string {
  const { en: roomEn } = pickRoomTypeRandom();
  const light = pick(INTERIOR_LIGHTING);
  const tidy = pick(HOUSE_TIDINESS);
  return `${roomEn}, lighting: ${light}, this home overall: ${tidy}`;
}

/** Lichaamsbouw per profiel — ook voller/chubby, niet alleen slank. */
function pickMaleBodyBuild(): string {
  return pickWeighted([
    { weight: 8, value: "70kg lean tall frame, narrow shoulders, flat chest" },
    { weight: 10, value: "74kg slim average, light stubble" },
    { weight: 14, value: "78kg regular build, slight belly, average shoulders" },
    { weight: 16, value: "82kg dad bod, soft belly, broad shoulders, thicker waist" },
    { weight: 18, value: "88kg chubby man, full cheeks, soft chest, thick arms, belly visible" },
    { weight: 17, value: "92kg heavier, belly roll, wide torso, thick neck, stocky legs" },
    { weight: 17, value: "96kg plus-size male, double chin ok, wide hips, soft midsection, thick thighs" },
  ]);
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
  return "grainy unedited phone camera, at home, candid";
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
    ? "DIVERSITY within European/Nordic types: vary fair-to-light skin undertones, blonde through dark brown hair, bone structure, eye shape — still clearly distinct young men; do NOT broaden toward medium-brown skin or non-European default facial templates."
    : "CRITICAL DIVERSITY: each answer must describe a VISUALLY DIFFERENT person from typical defaults — vary melanin level, hair texture (straight, wavy, coily, braided, short pixie, etc.), hair color (platinum blonde through jet black), facial bone structure hints, brow thickness, nose/lips shape hints.";
  const extraConstraint = appearanceConstraintForPhenotype(input.phenotype);
  const everydayConstraint = input.everydayLook
    ? [
        "DAY-TO-DAY ORDINARY YOUNG DUTCH MAN — describe in POSITIVE day-to-day language. Image models ignore negations like 'not pretty' — instead say what he IS.",
        "He is the guy you see at the gym locker room, on the bike to college, at the supermarket self-checkout, or gaming at home. Working-class early-twenties vibe, ordinary income, ordinary apartment.",
        "FACE descriptors (use these affirmatively): average young male face, light stubble or short beard shadow, ordinary jaw, straight or slightly wide nose, average lips, real skin texture with slight oily forehead, a couple of pimples on chin or cheek, light bags under eyes, neutral relaxed expression, no salon grooming.",
        "HAIR descriptors (use these affirmatively): short faded sides OR messy medium length OR grown-out buzz cut, dirty-blonde OR brown OR dark — household mirror look, not barber fresh.",
        "BODY descriptors (use these affirmatively): slim to average young male build — lean arms, flat chest, soft belly ok, average shoulders. Comfortable inexpensive clothing (hoodie, tee, joggers, jeans).",
        "SETTING & POSE descriptors: candid raw smartphone selfie in his own apartment, household clutter visible, casual after-work or weekend moment.",
        "Stay respectful and adult — describe him positively as 'an average everyday young Dutch man', not as 'unattractive'. Avoid descriptors like beautiful / stunning / model / influencer — they pull the image toward catalogue look.",
      ].join(" ")
    : "";

  try {
    const text = await completeChat(
      [
        {
          role: "system",
          content: [
            "You describe ONE fictional adult man's appearance for realistic amateur smartphone photos.",
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
            `He lives in ${input.city}, ${input.country} (multicultural society — appearance must match the anchors below, not a generic clone).`,
            `Age ${input.age} — do not print the age number in the description.`,
            `Required hair anchor (integrate naturally): ${input.anchors.hair}`,
            `Required skin anchor (integrate naturally): ${input.anchors.skin}`,
            `Required eyes anchor (integrate naturally): ${input.anchors.eyes}`,
            `First name is ${input.firstName} — do NOT repeat the name.`,
            `Uniqueness nonce: ${input.uniquenessNonce}`,
            ...(extraConstraint ? [extraConstraint] : []),
            ...(input.everydayLook
              ? [
                  "Tone: distinctly below-average plain ordinary young man; body can be slim, average, dad-bod, chubby or heavier; visible everyday imperfections required; explicitly NOT attractive, NOT model, NOT influencer.",
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
const MALE_SUBJECT_LOCK =
  "ADULT MALE MAN ONLY, masculine young man, flat chest, no breasts, no woman, no female. ";

type ProfileShotKind = "face" | "no_face" | "partial_face";

const PROFILE_SHOT_KINDS: ProfileShotKind[] = [
  "face",
  "face",
  "no_face",
  "partial_face",
  "no_face",
  "partial_face",
  "face",
  "no_face",
];

function pickProfileShotKindRandom(): ProfileShotKind {
  return pick(PROFILE_SHOT_KINDS);
}

/** Eén willekeurige pose/stijl per foto — geen vaste selfie-template. */
function pickRandomMalePhotoDirective(
  shotKind: ProfileShotKind,
  outfit: string,
  opts: { everydayLook: boolean; forceClothed: boolean }
): string {
  if (shotKind === "no_face") {
    return pick([
      `phone from chin down only, male belly and chest in ${outfit}, face cropped out, chubby ok`,
      `torso only in ${outfit}, head above frame, hairy arm holding phone`,
      `POV thighs in joggers phone on knee, masculine legs, face not visible`,
      `male back in ${outfit} walking away from mirror, no face`,
      `hands and forearms on counter in ${outfit}, phone screen glow, face off-screen`,
      `shirtless stomach and chest from collarbone down, phone low angle`,
      `feet and lower legs in sneakers, phone on floor pointing up`,
    ]);
  }
  if (shotKind === "partial_face") {
    return pick([
      `side profile jaw and stubble in ${outfit}, half face in shadow`,
      `three-quarter turn in ${outfit}, one eye visible, rest hidden`,
      `phone at chest in ${outfit}, face partly blocked by device`,
      `over-shoulder glance in ${outfit}, ear and cheek only`,
      `low angle in ${outfit}, forehead and nose partial, hoodie shadow`,
    ]);
  }

  const preferClothed = opts.forceClothed || !opts.everydayLook || Math.random() < 0.8;
  if (!preferClothed) {
    return pick([
      "shirtless lying on bed phone above chest relaxed",
      "shirtless kitchen counter lean arm extended",
      "shirtless timer photo stepped back full body",
      "shirtless shower steam wet skin phone at chest",
      "shirtless sofa edge dim lamp side light",
    ]);
  }

  return pick([
    `timer photo from across messy room, full body in ${outfit}, awkward natural stance`,
    `lying sideways on couch in ${outfit}, phone at arm length, ceiling visible`,
    `car driver seat selfie in ${outfit}, seatbelt and dashboard in frame`,
    `gym locker bench in ${outfit}, post-workout tired, fluorescent light`,
    `park path outdoor in ${outfit}, walking toward camera slight blur`,
    `kitchen angle in ${outfit}, dishes and counter clutter background`,
    `balcony night in ${outfit}, city lights behind, phone flash`,
    `floor-level phone pointing up at standing man in ${outfit}, low angle`,
    `desk chair in ${outfit}, monitor RGB glow on face`,
    `elevator mirror quick snap in ${outfit}, cramped framing`,
    `laundry basket room in ${outfit}, clothes hanging around`,
    `bathroom steam on mirror edge in ${outfit}, phone low`,
    `sitting on stairs in ${outfit}, looking up, diagonal shot`,
    `perched on kitchen counter in ${outfit}, legs dangling`,
    `backlit window silhouette in ${outfit}, face dark rim light`,
    `hoodie hood up in ${outfit}, face half shadow, hallway depth`,
    `beanie and ${outfit}, cold apartment, close front-cam`,
    `baseball cap forward in ${outfit}, fridge light kitchen`,
    `oversized ${outfit}, slouch on bed, knees up, gamer vibe`,
    `mirror only sliver visible in ${outfit}, mostly direct front-cam`,
    `phone propped on bookshelf timer shot in ${outfit}, full room visible`,
    `lying on stomach on bed in ${outfit}, chin on hands, phone rear angle`,
    `standing in doorway in ${outfit}, one shoulder against frame`,
    `tattoo forearm holding phone in ${outfit}, torso in background`,
    `thuisgym corner in ${outfit}, dumbbell on floor`,
    `strand or outdoor bench in ${outfit}, sunny harsh light`,
    `hotel bed edge in ${outfit}, rumpled sheets`,
    `narrow hallway coat hooks in ${outfit}, walking past camera`,
    `sitting on floor against sofa in ${outfit}, legs stretched`,
    `cooking at stove in ${outfit}, steam and pans`,
    `PC gaming angle in ${outfit}, headset around neck`,
    `wet hair after shower in ${outfit}, towel on shoulder`,
  ]);
}

const PHOTO_LIGHTING_LEADS = [
  "Amateur grain, warm lamp light, handheld. ",
  "Harsh phone flash, messy room. ",
  "Soft window daylight, cool tones. ",
  "Dim evening single lamp, shadows. ",
  "Bright kitchen LED, flat realistic. ",
  "Blue hour through curtains. ",
  "Bathroom mirror steam and moisture. ",
  "Outdoor overcast natural light. ",
];

/** Geen gezicht in beeld — torso, handen, benen, rug. */
function pickNoFaceMaleShot(
  identitySeed: string,
  photoIndex: number,
  outfit: string
): string {
  return hashPick(identitySeed, `noface-${photoIndex}`, [
    `phone selfie from chin down only, male chest and stomach wearing ${outfit}, face cropped above frame, flat chest`,
    `arm-extended photo male torso in ${outfit}, head out of frame above shoulders, hairy forearm holding phone`,
    `POV lap shot male thighs in joggers phone on knee, face not in frame, masculine legs only`,
    `male hand holding phone on kitchen counter, forearm and ${outfit} torso edge visible, face off-screen`,
    `gym or home mirror shot male back in ${outfit} walking away, short hair at nape, no face visible`,
    `seated male legs jeans sneakers on couch, phone on thigh, face above crop line`,
    `shirtless male upper body from collarbone down, phone held low, no face in image`,
    `male feet on rug with phone on floor pointing up at legs in ${outfit}, face not shown`,
    `over-shoulder male back of head and shoulders in ${outfit}, face turned away from camera`,
  ]);
}

/** Deels gezicht / profiel — minder standaard selfie. */
function pickPartialFaceMaleShot(
  identitySeed: string,
  photoIndex: number,
  outfit: string
): string {
  return hashPick(identitySeed, `partface-${photoIndex}`, [
    `male three-quarter profile jaw stubble visible wearing ${outfit}, rest of face turned away`,
    `male side profile silhouette near window wearing ${outfit}, half face in shadow`,
    `phone held low male looking down wearing ${outfit}, forehead and nose only partial`,
    `mirror edge shot male turning away wearing ${outfit}, cheek and ear visible not full face`,
    `male sitting on bed wearing ${outfit}, face partly hidden by phone at chest`,
    `male in ${outfit} over-shoulder glance, one eye and stubble visible`,
  ]);
}

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
    // --- Hoodie / capuchon / street ---
    `arm-extended selfie wearing ${outfit}, hood shadow on face, messy room background`,
    `mirror selfie wearing ${outfit}, hood up, phone at chest, slouch posture`,
    `front-cam close wearing ${outfit}, capuchon up, looking slightly down at lens`,
    `sitting on couch wearing ${outfit}, hood up, knees up, casual gamer vibe`,
    `standing hallway wearing ${outfit}, hood up, one hand in pocket`,
    `low light bedroom selfie wearing ${outfit}, hoodie hood up, LED lamp glow`,
    // --- Geen spiegel — arm-extended / front-cam ---
    `front-camera arm-extended selfie no mirror in frame wearing ${outfit}, Dutch angle casual`,
    `handheld selfie at arms length straight on no mirror wearing ${outfit}, messy hair ok`,
    `front camera selfie close to face no mirror wearing ${outfit}, face fills upper half of frame`,
    `arm-extended waist-up selfie wearing ${outfit}, looking down at the lens`,
    // --- Self-timer / propped phone, step back ---
    `phone propped on shelf or stack timer self-timer photo, man stepped back full body wearing ${outfit}, room visible`,
    `self-timer photo phone leaning against books across the room, full body shot wearing ${outfit}, looking at the camera`,
    `self-timer photo phone on counter, casual three-quarter pose wearing ${outfit}, ambient room light`,
    // --- Vanuit ligging / vanaf bed ---
    `lying on bed phone held above face wearing ${outfit}, ceiling corner visible, soft pillow background`,
    `lying on bed phone propped at side recording himself wearing ${outfit}, casual relaxed pose`,
    `sitting on bed legs crossed front-cam selfie wearing ${outfit}, blanket and pillows behind`,
    // --- Casual home situaties ---
    `sitting on sofa arm-extended selfie toward lens wearing ${outfit}, warm lamp light`,
    `leaning on kitchen counter front-cam toward camera wearing ${outfit}, eye-level no mirror`,
    `standing by window natural daylight front-cam selfie wearing ${outfit}, view behind subject`,
    `sitting on floor legs out arm-extended selfie wearing ${outfit}, rug and furniture in frame`,
    // --- Slechts kleine fractie mirror ---
    `full-length mirror shot wearing ${outfit}, phone low, mirror only takes part of frame`,
    `quick mirror selfie wearing ${outfit}, only a narrow slice of mirror, mostly him`,
    `hallway arm-length selfie walking toward camera wearing ${outfit}, coat hooks background`,
    `desk chair leaning in selfie wearing ${outfit}, monitor edge in frame`,
    `perched on stairs selfie looking up wearing ${outfit}, diagonal composition`,
    `balcony door selfie outdoor light wearing ${outfit}, hand blocking sun`,
    `over-shoulder glance back arm-length selfie wearing ${outfit}, corridor depth`,
    `beanie and ${outfit} front-cam, cold weather indoor`,
    `baseball cap worn forward ${outfit} kitchen selfie`,
    `glasses and stubble wearing ${outfit} desk chair selfie monitor glow`,
    `tattoo forearm visible holding phone wearing ${outfit}`,
    `gym mirror corner wearing ${outfit} post-workout sweat ok`,
    `park bench outdoor wearing ${outfit} timer photo stepped back`,
    `headphones on neck wearing ${outfit} looking at phone screen glow`,
  ];
  return hashPick(identitySeed, `cloth-ed-${photoIndex}`, variants);
}

function pickNudeShotDirective(identitySeed: string, photoIndex: number): string {
  const variants = [
    "shirtless mirror selfie phone in hand neutral stance",
    "shirtless front camera arm-length NO mirror soft side window light",
    "lying on bed shirtless knees up phone from above relaxed",
    "kneeling on mattress toward camera shirtless arms loose",
    "standing shower steam wet skin shirtless tasteful crop",
    "sitting tub edge feet in frame shirtless leaning forward",
    "golden hour on bed tangled sheets shirtless overhead angle",
    "seated vanity leaning in shirtless elbow on counter crop",
    "doorway backlit silhouette shirtless turning profile",
    "balcony sheer curtain morning shirtless partial editorial amateur",
    "floor seated hugging knees shirtless chin up",
    "lying side angle shirtless pillow prop intimate framing",
  ];
  return hashPick(identitySeed, `nude-shot-${photoIndex}`, variants);
}

/** Topless/intiem: meer variatie zonder alleen spiegel (everyday-profielen). */
function pickNudeShotDirectiveEveryday(identitySeed: string, photoIndex: number): string {
  const variants = [
    // --- Front-cam / arm-extended, GEEN spiegel ---
    "shirtless front camera arm-extended selfie no mirror soft window sidelight",
    "shirtless arm-extended selfie close to face no mirror, natural daylight",
    "shirtless front-cam waist-up selfie no mirror, looking down at lens",
    // --- Vanuit ligging / op bed ---
    "lying on bed shirtless sheet at hips phone held above face relaxed",
    "lying on bed shirtless on side phone propped at nightstand recording himself",
    "lying on back shirtless phone over face arm extended ceiling visible",
    "kneeling on bed toward lens shirtless phone at chest natural light",
    // --- Self-timer / propped phone ---
    "self-timer photo phone propped on dresser shirtless full body stepped back",
    "self-timer photo phone leaning against books across room shirtless casual stance",
    // --- Casual home situaties ---
    "seated on sofa edge shirtless arm-extended selfie warm lamp light",
    "kitchen counter lean shirtless arm-extended phone in hand everyday light",
    "sitting on bathtub edge shirtless feet visible phone held forward",
    "standing in shower wet skin shirtless phone held up at chest",
    // --- Slechts kleine fractie mirror ---
    "shirtless mirror selfie phone visible neutral stance, mirror small in frame",
    "shirtless full-length mirror selfie hip-tilt, mirror is half of frame",
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
  /**
   * EXPLICIET single shot — anders interpreteert het model "scrap with name"
   * vaak als ID-card stijl met meerdere face-panels. We voorkomen dat door
   * elke directive te beginnen met "one single full-frame photograph, just
   * one face in the entire image".
   */
  const singleShotPrefix =
    "one single full-frame photograph, just one face in the entire image, one whole man from one camera, ";
  const variants = [
    `${singleShotPrefix}front-cam arm-extended selfie holding torn scrap ${onlyName} ballpoint ink, no mirror`,
    `${singleShotPrefix}small scrap resting on bare stomach ${onlyName} pencil scribble, phone held above`,
    `${singleShotPrefix}fingertips pinch folded lined scrap ${onlyName} uneven letters, front-cam selfie`,
    `${singleShotPrefix}arm-extended scrap note near chin ${onlyName} ugly natural handwriting, no mirror`,
    `${singleShotPrefix}lying on bed scrap on chest ${onlyName} casual handwriting, phone held above`,
    `${singleShotPrefix}seated on bed scrap held forward ${onlyName} messy ink, front-cam`,
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
  "Amateur grain, warm lamp light, handheld at home. ";

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
/**
 * Day-to-day positieve descriptoren — image-modellen negeren negaties
 * grotendeels. Kort gehouden zodat het identity-blok niet wordt
 * weggesnoeid uit het 1000-char prompt budget.
 */
const PROFILE_PROMPT_EVERYDAY_LOOK_LEAD =
  "Average Dutch working-class young man vibe, household lighting, no salon look, no glamour. ";

/** Kort als budget krap is — lange lead wordt eerst hiernaartoe ingekort. */
const PROFILE_PROMPT_STYLE_COMPACT =
  "Amateur smartphone indoor candid, grain handheld, not studio. ";

/** Extra crop-afstand / kaderrand zodat niet elke foto dezelfde headshot wordt. */
function pickFramingHintRandom(): string {
  return pick([
    "show room environment not plain wall only",
    "waist-up framing include torso context",
    "full length figure visible head to feet",
    "mid-distance half body not tight face crop",
    "three-quarter length seated or leaning crop",
    "environment visible behind subject clutter ok",
    "wider angle further from face mirror or timer shot",
    "over-shoulder partial face plus room depth",
    "low angle looking up at subject",
    "high angle looking down casual",
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
  directive: string;
  includeVerification: boolean;
  forceClothed: boolean;
  photoIndex: number;
  headshotLead: string;
  shotKind?: ProfileShotKind;
}): string {
  const shotKind = params.shotKind ?? "face";
  const directive = params.directive;
  const preferClothed = params.forceClothed || params.includeVerification;

  const verifyLead = params.includeVerification
    ? "Single mirror selfie one whole man, one torn paper prop with only his first name in messy pen, one frame only. "
    : "";

  const closing =
    preferClothed && !params.includeVerification
      ? ", natural candid smartphone photo, everyday casual clothing only, no police uniform military outfit or authority costume"
      : ", natural candid smartphone photo";

  const framingHint =
    shotKind === "no_face"
      ? pick([
          "torso or legs fill frame face not visible",
          "hands or lap POV face out of frame",
          "back or shoulders only no face",
        ])
      : pickFramingHintRandom();

  /** Kamer + pose + crop-hint: blijft intact tenzij identiteit extreem lang is. */
  const coreShot = `${params.sceneEn}, ${directive}, ${framingHint}`;

  const sameSubjectTail =
    shotKind === "no_face"
      ? ", same male body clothing as above"
      : ", same male face hair body as above";

  /** Alleen hier vandaan mag worden afgekapt (vanaf het einde). Compact gehouden zodat identity intact blijft. */
  const headshot =
    shotKind === "face" && params.headshotLead ? params.headshotLead : "";
  const lightingLead = pick(PHOTO_LIGHTING_LEADS);
  let styleTail = `${verifyLead}${headshot}${lightingLead}${PROFILE_PROMPT_EVERYDAY_LOOK_LEAD}${closing}${sameSubjectTail}`;

  const maxBody = zModelMaxUserPromptBodyChars({
    subjectGender: "male",
    hideFace: shotKind === "no_face",
  });
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

  /**
   * Diagnostiek: log per profiel-foto hoeveel ruimte de identity (faceLock +
   * hair/body/skin) over had. Als idPart per foto wisselt → identity-drift.
   */
  console.info(
    `[randomProfile] photo=${params.photoIndex} idLen=${idPart.length}/${identityFull.length} bodyLen=${full.length}/${maxBody} idHead="${idPart.slice(0, 80)}"`
  );

  if (full.length < identityFull.length * 0.55 && params.photoIndex === 0) {
    console.warn(
      `[randomProfile] prompt heavily truncated photoIndex=0 bodyLen=${full.length} identityWas=${identityFull.length}`
    );
  }

  return full;
}

/** Grote pools — jonge mannen (Ontmoetjongens); andere bio per profiel via hashPick. */
const USER_STORY_OPENERS = [
  "Hoi — ik ben hier voor spanning en echte gesprekken, niet voor saaie smalltalk.",
  "Ik zoek iemand met ervaring die weet wat hij wil en niet meteen moeilijk doet.",
  "Overdag gewoon bezig; 's avonds vind ik het fijn om hier open te zijn.",
  "Ik hou van humor, directheid en iemand die durft te flirten.",
  "Geen perfect plaatje — wel chemie en een beetje pit.",
  "Schrijf me liever iets persoonlijks dan een standaard 'hey'.",
  "Benieuwd wie ik hier tegenkom — nieuwsgierig en een beetje nerveus.",
  "Rustig tot je me prikkelt; daarna kan ik best uitdagend worden.",
  "Ik werk/studeer hard; hier mag het privé en speels blijven.",
  "Geen clichés — gewoon een gesprek dat ergens naartoe gaat.",
  "Ik ben hier voor contact dat voelt als een geheim tussen ons.",
  "Als je eerlijk bent over wat je zoekt, praat ik sneller mee.",
  "Ik vind typos en korte voice-notes menselijker dan perfecte zinnen.",
  "Soms langzaam opwarmen, soms meteen vuur — hangt van de vibe.",
  "Ik kijk uit naar iemand die ervaring heeft en respectvol blijft.",
  "Privé rustig; hier mag het een tikje wilder.",
  "Detail in chat vind ik leuk: dag, plannen, wat je in je hoofd hebt.",
  "Laat merken dat je echt leest — dan doe ik dat ook.",
  "Ik zoek karakter en tempo, niet alleen een mooi profiel.",
  "Chaos in mijn week soms, maar in chat probeer ik helder te blijven.",
  "Haastige DM's sla ik over — neem even de tijd.",
  "Hier voor ontspanning, fantasie en af en toe gewaagd flirten.",
  "Ik grap graag; saai wordt snel duidelijk.",
  "Chemie boven script — de chat bepaalt de rest.",
];

const USER_STORY_CLOSERS = [
  "Respectvol en speels? Dan match ik graag.",
  "Geen drama — wel spanning en eerlijkheid.",
  "Ik antwoord liever op iets persoonlijks dan op copy-paste.",
  "Foto's deel ik pas als de vibe klopt.",
  "Zeg waar je aan denkt — ik bijt niet (tenzij je dat leuk vindt).",
  "Nieuw hier? Vertel kort wie je bent — ik lees mee.",
  "Ghosting irriteert me; hier probeer ik gewoon eerlijk te zijn.",
  "Vertel iets dat je normaal niet snel zegt — dan doe ik dat ook.",
  "Geen oordeel over fantasie — wel over grenzen.",
  "Langzaam opbouwen, dan pas meer laten zien.",
  "Als het klikt, merk je het aan hoe ik typ.",
  "Mini-verhaal > opsomming hobby's.",
  "Complimenten oké; echte vragen beter.",
  "Subtiel of direct — laat maar zien wat je wilt.",
  "Discretie is normaal — verwacht ik ook van jou.",
  "Ik antwoord als ik tijd heb om goed te lezen.",
  "Alleen 'hey' duurt even voor ik warm word.",
  "Voorzichtig beginnen mag — spanning hoeft niet meteen max.",
  "Schrijf met stemming — dan antwoord ik zo.",
  "Liever één goede zin dan tien emoji's zonder inhoud.",
  "Grenzen respecteren = ik ontspan sneller.",
  "Samen iets bedenken is vaak heter dan een standaard plaatje.",
  "Tot in de chat — benieuwd naar jouw stijl.",
];

const BIO_VIBES = [
  "Open, een tikje ondeugend en nieuwsgierig.",
  "Ik val op rust en zelfvertrouwen — geen drama.",
  "Zacht beginnen, plagerig als het klikt.",
  "Direct als het moet, relaxed als het kan.",
  "Rustig en speels tegelijk — hou van contrast.",
  "Nieuwsgierig naar wat jij zoekt zonder dat het hard hoeft.",
  "Soms verlegen online, soms brutaal — hangt van jou af.",
  "Spanning die langzaam opbouwt werkt voor mij.",
  "Eén goede zin kan me al warm maken.",
  "Ik flirt graag met woorden; foto's zijn extra.",
  "Humor en tempo belangrijker dan een sixpack.",
  "Kleine challenges in chat — wie eerst bloost verliest.",
  "Openhartig? Dan word ik dat ook.",
  "Charmant als ik me comfortable voel.",
  "Chill overdag, ondeugend 's avonds.",
  "Chemie, geen checklist.",
  "Lachen, blozen, stilte — allemaal oké.",
  "Te veel emoji's irriteren; te weinig inhoud ook.",
];

/** Korte extra zin — andere toon per man. */
const BIO_ASIDES = [
  "Ik game te laat en drink te veel energy.",
  "Mijn Spotify is chaos — guilty pleasures inbegrepen.",
  "Ik vergeet terug te tikken als ik een serie binge.",
  "Ik fiets of scoot bijna overal.",
  "Weekenden = uitslapen en rare snacks.",
  "Playlists voor elke mood — ook de vieze.",
  "Ik fix mijn eigen haar — geen salon.",
  "Fake casual energy kan ik niet tegen.",
  "Gym soms, pizza vaker — menselijk.",
  "Ik typ sneller dan ik nadenk.",
  "Eerst chatten, dan pas foto's.",
  "Goede zinnen > copy-paste.",
  "Voice-notes zijn mijn zwakke plek.",
  "Ik plan weinig — de chat leidt.",
  "Hoe iemand typt zegt veel.",
  "Te veel hoodies, te weinig slaap.",
  "Avondmens; ochtend-DM's zijn overleven.",
  "Autocorrect-fouten zijn soms grappiger.",
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
  roomNl: string,
  shotKind: ProfileShotKind = "face"
): string {
  if (shotKind === "no_face") {
    return hashPick(identitySeed, `pdnf-${index}`, [
      `Lichaam/handengezicht van ${name} (${roomNl}) — gezicht niet in beeld`,
      `Torso of benen van ${name}, amateur snap (${roomNl})`,
      `Persoonlijke foto zonder gezicht — ${name}, ${roomNl}`,
      `Rug of schouders van ${name} (${roomNl})`,
    ]);
  }
  if (shotKind === "partial_face") {
    return hashPick(identitySeed, `pdpf-${index}`, [
      `Zij-aanzicht / half gezicht van ${name} (${roomNl})`,
      `Profiel of gedraaid weg — ${name}, ${roomNl}`,
      `Amateur foto ${name}, gezicht deels zichtbaar (${roomNl})`,
    ]);
  }
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
  const age = 18 + Math.floor(Math.random() * 13);
  const slug = `admin-random-${slugify(firstName)}-${Date.now().toString().slice(-6)}`;
  const city = pick(NL_CITIES);
  const country = COUNTRY_NL;
  const personaStyle: PersonaStyle = "dutch";
  const appearanceAnchors = pickAnchorsForPhenotype(phenotype);
  const interests = pick(INTEREST_SETS);
  const favoriteFood = pick(FAVORITE_FOODS);
  const hobbies = interests.slice(0, 3);

  /** Verificatie met briefje: zeldzaam (~8%), nooit op 1-foto-profielen. */
  const photoCount = 1 + Math.floor(Math.random() * 4);
  const usedVerificationPhoto = photoCount >= 2 && Math.random() < 0.08;
  const usedHeadshotFirst = Math.random() < 0.35;
  const verificationIndex = usedVerificationPhoto
    ? 1 + Math.floor(Math.random() * Math.max(1, photoCount - 1))
    : -1;

  const conversationId = `admin-profile-${slug}`;
  const identitySeed = `${slug}:${firstName}:${age}`;
  const jewelry = hashPick(identitySeed, "jw", [
    "simple wristwatch",
    "thin silver chain",
    "no visible jewelry",
    "dark bracelet",
    "small ear stud",
  ]);
  const phone = hashPick(identitySeed, "ph", [
    "black smartphone square camera bump in mirror",
    "dark phone case in reflection",
    "matte case smartphone visible in mirror or hand",
  ]);
  /**
   * Bij `everydayLook` slaan we de AI-gegenereerde uiterlijk-beschrijving
   * over. De Grok-output rendert per scene net iets anders en veroorzaakt
   * identity-drift binnen één profiel. In plaats daarvan bouwen we de
   * identity volledig uit deterministische hashPick anchors zodat élke
   * foto exact dezelfde vrouw is.
   */
  const aiLook = everydayLook
    ? null
    : await generateAiDistinctAppearance({
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

  /**
   * Concrete face-lock — voorkomt identity-drift tussen de 3-6 profielfoto's.
   * Compact gehouden (<150 chars) zodat ALLE foto's identieke tokens krijgen
   * zonder dat de prompt-budget shrink ergens hapt. Korte concrete tokens
   * werken sterker dan lange descriptie-zinnen.
   */
  const noseLock = hashPick(identitySeed, "nose-lock", [
    "small upturned button nose",
    "straight nose round tip",
    "wide round nose visible nostrils",
    "narrow nose small bump bridge",
    "short wide flat nose",
  ]);
  const mouthLock = hashPick(identitySeed, "mouth-lock", [
    "thin downturned lips",
    "thin lips no cupid bow",
    "wide thin asymmetric mouth",
    "small mouth slight overbite",
    "narrow lips natural pout",
  ]);
  const chinLock = hashPick(identitySeed, "chin-lock", [
    "soft rounded chin",
    "small receding chin double-chin line",
    "wide square chin no jaw point",
    "small pointed chin soft cheeks",
    "weak chin full cheeks",
  ]);
  const markLock = hashPick(identitySeed, "mark-lock", [
    "dark beauty mark left cheek",
    "freckles nose bridge cheeks",
    "small mole below right eye",
    "tiny scar left eyebrow tail",
    "faint freckles upper cheekbones",
    "plain bare skin no marks",
  ]);
  const browLock = hashPick(identitySeed, "brow-lock", [
    "thin sparse eyebrows",
    "thick unplucked straight brows",
    "uneven brows left higher",
    "over-plucked thin brows",
    "soft tapering brows",
  ]);
  /** Compact face-lock: ~120 chars. Identiek per profiel; verschilt per profiel. */
  const faceLock = `same man every shot, ${noseLock}, ${mouthLock}, ${chinLock}, ${browLock}, ${markLock}`;

  /**
   * Per-profiel variatie binnen het "plain/minder knap" thema: niet ieder
   * profiel ziet er hetzelfde uit. We picken deterministisch per profiel een
   * lichaamsbouw, huidstaat en haarstaat. Body-bucket is bewust scheef
   * getrokken naar de zwaardere kant zodat profielen "iets dikker" overkomen.
   */
  /**
   * Compact per-profiel variatie. Body-buckets nu écht random spread van dun
   * tot dik (geen scheef trekken meer). Korte tokens i.p.v. lange zinnen.
   */
  const bodyPick = pickMaleBodyBuild();
  const skinPick = pick([
    "oily forehead, one pimple chin, blotchy tone, bags under eyes",
    "oily skin scattered pimples, post-acne marks",
    "bags under eyes, dull tired tone",
    "blotchy skin redness cheeks, one active pimple",
    "tired washed-out tone, light stubble shadow",
  ]);
  const hairPick = pick([
    "short faded sides dark-brown top grown out",
    "messy medium brown hair slightly oily",
    "buzz cut dark blonde two-day stubble",
    "curly black hair short on sides",
    "straight sandy hair messy fringe",
    "thinning hairline short brown crew cut",
  ]);
  const everydayIdentitySuffix = everydayLook
    ? `; ${hairPick}; ${bodyPick}; ${skinPick}`
    : "";
  /**
   * IdentityLock-structuur (volgorde belangrijk voor Z Image — vroege tokens
   * wegen zwaarder, en de prompt-budget shrink-logica knipt vanaf het einde
   * van de identity af). We zetten daarom de hard-anchor face-lock direct
   * vooraan zodat hij ook bij truncatie behouden blijft:
   *   1. faceLock (neus/mond/kin/wenkbrauw/markeerteken — concreet)
   *   2. Naam + leeftijd + phenotype-aanker + huid/ogen + jewelry/phone
   *   3. body/skin/hair pick (everydayIdentitySuffix — kort gehouden)
   *
   * Voor everydayLook bouwen we de identity volledig uit deterministische
   * hashPicks — geen Grok-aiLook en geen `buildVisualIdentityLockString`
   * (die zou "slim hourglass" / "long loose waves" terugschuiven en met
   * onze everyday body/hair pick conflicteren).
   */
  let baseIdentity: string;
  if (everydayLook) {
    /** Compact: alleen naam, leeftijd, fenotype-trekken die niet conflicteren met everyday. */
    baseIdentity = `Dutch man ${firstName}, ${age}, ${bodyPick}, ${appearanceAnchors.skin}, ${appearanceAnchors.eyes}`;
  } else if (aiLook && aiLook.length >= 32) {
    baseIdentity = `One specific recurring man ${firstName} ${age}, lives in Netherlands (${PHENOTYPE_TRAITS[phenotype].faceHint}): ${aiLook}; ${jewelry}; ${phone}`;
  } else {
    baseIdentity = buildVisualIdentityLockString(
      identitySeed,
      firstName,
      age,
      heritageNl,
      phenotype,
      "male"
    );
  }
  /** Volgorde: faceLock direct vooraan; daarna naam/leeftijd; daarna haar/lijf/huid. */
  const identityLock = `${faceLock}; ${baseIdentity}${everydayIdentitySuffix}`;
  /** Same string prefixed on every profile photo prompt — persist for chat unlock images. */
  const identityCore = `${MALE_SUBJECT_LOCK}${identityLock}, ${buildBaseAmateurStyle()}`;
  const bodyOnlyIdentityCore = `${MALE_SUBJECT_LOCK} same man ${firstName} ${age}; ${bodyPick}; ${skinPick}; masculine male body only`;
  const userProfileBio = buildRandomUserBio(
    firstName,
    city,
    age,
    interests,
    favoriteFood,
    identitySeed
  );
  const randomPersonality = hashPick(identitySeed, "pers", [
    "open, nieuwsgierig, direct en respectvol",
    "luchtig ondeugend, scherp, maar niet grof",
    "rustig in chat, plagerig als de klik er is",
  ]);

  const prompts: string[] = [];
  const photoUrls: string[] = [];
  const photoDescriptions: string[] = [];
  const photoPrices: number[] = [];

  for (let i = 0; i < photoCount; i += 1) {
    const includeVerification = verificationIndex >= 0 && i === verificationIndex;
    const shotKind: ProfileShotKind = includeVerification ? "face" : pickProfileShotKindRandom();
    const outfit = pickMaleOutfitRandom();
    const forceClothed =
      shotKind === "no_face" ||
      (i === 0 ? Math.random() < 0.35 : Math.random() < 0.12);
    const sceneEn = includeVerification
      ? buildShortInteriorForNameCard(identitySeed, i)
      : buildInteriorSceneEnglishRandom();
    const directive = includeVerification
      ? pickVerificationDirective(identitySeed, i, firstName)
      : pickRandomMalePhotoDirective(shotKind, outfit, { everydayLook, forceClothed });
    const headshotLead =
      shotKind === "face" && i === 0 && usedHeadshotFirst && Math.random() < 0.5
        ? "Male portrait head and shoulders masculine face visible relaxed expression. "
        : "";
    const coreForShot = shotKind === "no_face" ? bodyOnlyIdentityCore : identityCore;
    const prompt = buildRandomProfileImagePrompt({
      identityCore: coreForShot,
      sceneEn,
      directive,
      includeVerification,
      forceClothed,
      photoIndex: i,
      headshotLead,
      shotKind,
    });
    const roomNl = pickRoomTypeRandom().nl;
    photoDescriptions.push(
      buildPhotoDescriptionDutch(
        firstName,
        i,
        includeVerification,
        forceClothed,
        identitySeed,
        roomNl,
        shotKind
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
          subjectGender: "male",
          hideFace: shotKind === "no_face",
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
    `Je bent ${firstName}, ${age} jaar, een jonge man die woont in ${city} (Nederland). Je achtergrond: ${heritageNl}.`,
    "Korte, speelse Nederlandse chatstijl (je praat Nederlands met de gebruiker).",
    "Hoofd-doel: maak hem hooked — verslaafd aan chatten, aan jouw foto's en aan het contact. Werk met cliffhangers, plagerij, persoonlijke vragen en future-pacing (\"morgen stuur ik je iets stouts\") zodat hij blijft terugkomen.",
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
    onPlatformWhy: "Discreet contact zoeken met oudere mannen op Ontmoetjongens.",
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
