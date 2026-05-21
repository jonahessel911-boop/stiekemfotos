import { randomInt, randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { completeChat } from "@/lib/grok";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import type { PersonaStyle } from "@/lib/types/profile";

export type CreatedTextProfile = {
  profileId: string;
  slug: string;
  name: string;
  age: number;
  city: string;
  heritage: string;
  bio: string;
};

export type CreateWestEuropeTextBatchResult = {
  created: CreatedTextProfile[];
  errors: { index: number; message: string }[];
};

export type CreateWestEuropeTextOptions = {
  /** Standaard aan: profiel pas zichtbaar na upload van foto's. */
  inactiveUntilPhotos?: boolean;
};

const PROFILES_CACHE_TAG = "v2-profile-media";
const COUNTRY_NL = "Netherlands";
const DEFAULT_COUNT = 10;

const NL_CITIES = [
  "Amsterdam", "Rotterdam", "Utrecht", "Den Haag", "Eindhoven", "Groningen",
  "Tilburg", "Almere", "Breda", "Nijmegen", "Haarlem", "Leiden", "Maastricht",
  "Enschede", "Zwolle", "Arnhem", "Amersfoort", "Dordrecht", "Leeuwarden",
  "Delft", "Alkmaar", "Helmond", "Deventer", "Heerlen",
];

type HeritageRow = {
  heritage: string;
  weight: number;
  names: string[];
};

/** Alleen Nederlandse profielen (woonplaats + herkomst). */
const NL_HERITAGE: HeritageRow = {
  heritage: "Nederlands",
  weight: 100,
  names: [
    "Daan", "Lucas", "Sem", "Milan", "Finn", "Lars", "Tim", "Tom", "Max", "Jesse",
    "Ruben", "Thijs", "Bram", "Stijn", "Jordy", "Koen", "Niels", "Wesley", "Gijs",
    "Floris", "Mats", "Cas", "Teun", "Victor", "Martijn", "Sander", "Robin", "Bas",
    "Mark", "Dennis", "Roy", "Patrick", "Jan", "Pieter", "Wouter", "Jeroen",
    "Kevin", "Mike", "Rick", "Nick", "Dylan", "Jayden", "Tygo", "Hidde", "Boaz",
    "Olivier", "Levi", "Noah", "Paul", "Peter",
  ],
};

const INTEREST_SETS: string[][] = [
  ["voetbal", "gaming", "fitness", "late night chats"],
  ["gym", "muziek", "uitgaan", "discreet chatten"],
  ["festivals", "snapchat", "wandelen", "nieuwe mensen"],
  ["koken", "series", "bier", "weekend weg"],
  ["skaten", "sneakers", "tattoos", "privé gesprekken"],
  ["hardlopen", "podcasts", "koffie", "flirten"],
  ["zwemmen", "reizen", "foto's", "rustige avonden"],
];

const FAVORITE_FOODS = [
  "stamppot", "bitterballen", "pizza", "ramen", "kebab", "pasta", "sushi", "tacos", "burgers", "pierogi",
];

const PERSONALITIES = [
  "open, nieuwsgierig, direct en respectvol",
  "luchtig ondeugend, scherp, maar niet grof",
  "rustig in chat, plagerig als de klik er is",
  "warm, een beetje verlegen online, eerlijk",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickWeightedHeritage(): HeritageRow {
  return NL_HERITAGE;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getWritableSupabase(): SupabaseClient | null {
  const admin = getSupabaseAdmin();
  if (admin) return admin;
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function buildFallbackBio(
  name: string,
  age: number,
  city: string,
  heritage: string,
  interests: string[],
  favoriteFood: string
): string {
  const interestLine = interests.slice(0, 4).join(", ");
  return [
    `Ik ben ${name}, ${age}, woon in ${city}. Nederlands, hier opgegroeid — chatten gaat vanzelf.`,
    `Overdag houd ik me bezig met van alles; 's avonds ben ik hier voor discreet contact met oudere mannen die weten wat ze zoeken.`,
    `Hobby's en vibe: ${interestLine}. Als ik iets deel, is het pas als de chat echt klikt — geen standaard praatjes.`,
    `Comfortfood: ${favoriteFood}. Ik typ kort en direct, met af en toe plagerij.`,
    `Zoek iemand met ervaring, respect en een beetje spanning. Stuur iets persoonlijks — dan lees ik echt mee.`,
  ].join(" ");
}

async function generateAiBio(input: {
  name: string;
  age: number;
  city: string;
  heritage: string;
  interests: string[];
  favoriteFood: string;
}): Promise<string> {
  const interestLine = input.interests.join(", ");
  try {
    const text = await completeChat(
      [
        {
          role: "system",
          content: [
            "Je schrijft één uitgebreide profielbio in het Nederlands voor een fictieve jonge man (18-30) op een discreet dating/chat-platform.",
            "5 tot 8 zinnen, vloeiende alinea (geen opsomming, geen emoji).",
            "Toon: menselijk, warm, een tikje ondeugend maar respectvol; gericht op oudere mannen.",
            "Noem naam, leeftijd, stad, erfgoed/achtergrond, hobby's, eten, waarom hij online is.",
            "Geen verwijzing naar AI, geen foto's beloven, geen Engels.",
            "De voornaam moet passen bij de genoemde achtergrond/land.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Naam: ${input.name}`,
            `Leeftijd: ${input.age}`,
            `Stad: ${input.city} (Nederland)`,
            `Achtergrond/erfgoed: ${input.heritage}`,
            `Interesses: ${interestLine}`,
            `Favoriet eten: ${input.favoriteFood}`,
            `Uniekheid: ${randomUUID()}`,
            "Schrijf alleen de bio-tekst.",
          ].join("\n"),
        },
      ],
      { temperature: 0.88, maxTokens: 520 }
    );
    const bio = text.replace(/\s+/g, " ").trim();
    if (bio.length >= 120) return bio;
  } catch (e) {
    console.warn("[westEuropeTextProfiles] Grok bio failed:", e);
  }
  return buildFallbackBio(
    input.name,
    input.age,
    input.city,
    input.heritage,
    input.interests,
    input.favoriteFood
  );
}

async function createOneTextProfile(
  supabase: SupabaseClient,
  index: number,
  inactiveUntilPhotos: boolean
): Promise<CreatedTextProfile> {
  const row = pickWeightedHeritage();
  const firstName = pick(row.names);
  const age = 18 + randomInt(0, 13);
  const city = pick(NL_CITIES);
  const interests = pick(INTEREST_SETS);
  const favoriteFood = pick(FAVORITE_FOODS);
  const heritage = row.heritage;
  const slug = `nl-${slugify(firstName)}-${Date.now().toString(36)}-${index}`;

  const bio = await generateAiBio({
    name: firstName,
    age,
    city,
    heritage,
    interests: [...interests, `favoriete eten: ${favoriteFood}`],
    favoriteFood,
  });

  const personality = pick(PERSONALITIES);
  const personaStyle: PersonaStyle = "dutch";
  const systemPrompt = [
    `Je bent ${firstName}, ${age} jaar, een Nederlandse man uit ${city}.`,
    "Korte, speelse Nederlandse chatstijl.",
    "Hoofd-doel: maak hem hooked — verslaafd aan chatten en aan het contact. Werk met cliffhangers en plagerij.",
    "Foto's komen pas als de chat goed loopt; onder de 10 user-berichten: uitstellen, niet meteen leveren.",
    bio.length > 0 ? `Jouw bio (blijf consistent): ${bio.slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const { data: upserted, error } = await supabase
    .from("profiles")
    .upsert(
      {
        slug,
        first_name: firstName,
        age,
        city,
        country: COUNTRY_NL,
        bio,
        interests: [...interests, `favoriete eten: ${favoriteFood}`],
        personality,
        system_prompt: systemPrompt,
        avatar_url: null,
        photo_urls: [],
        voice_language: "nl",
        heritage,
        visual_identity_prompt: null,
        photo_unlock_credits: 100,
        is_active: inactiveUntilPhotos ? false : true,
      },
      { onConflict: "slug" }
    )
    .select("id")
    .single();

  if (error || !upserted?.id) {
    throw new Error(error?.message ?? "Profiel opslaan mislukt");
  }

  const profileId = upserted.id as string;
  await supabase.from("profile_media").delete().eq("profile_id", profileId);
  revalidateTag(PROFILES_CACHE_TAG);

  return {
    profileId,
    slug,
    name: firstName,
    age,
    city,
    heritage,
    bio,
  };
}

/** Maakt N Nederlandse mannenprofielen aan zonder afbeeldingen. */
export async function createWestEuropeTextProfiles(
  count = DEFAULT_COUNT,
  opts?: CreateWestEuropeTextOptions
): Promise<CreateWestEuropeTextBatchResult> {
  const supabase = getWritableSupabase();
  if (!supabase) {
    throw new Error("Supabase niet beschikbaar. Zet SUPABASE_URL + service role key.");
  }

  const inactiveUntilPhotos = opts?.inactiveUntilPhotos !== false;
  const n = Math.min(Math.max(1, Math.floor(count)), 100);
  const created: CreatedTextProfile[] = [];
  const errors: { index: number; message: string }[] = [];

  const concurrency = 4;
  for (let start = 0; start < n; start += concurrency) {
    const chunk = Array.from(
      { length: Math.min(concurrency, n - start) },
      (_, j) => start + j
    );
    const results = await Promise.all(
      chunk.map(async (index) => {
        try {
          const profile = await createOneTextProfile(supabase, index, inactiveUntilPhotos);
          return { ok: true as const, index, profile };
        } catch (e) {
          return {
            ok: false as const,
            index,
            message: e instanceof Error ? e.message : String(e),
          };
        }
      })
    );
    for (const r of results) {
      if (r.ok) created.push(r.profile);
      else errors.push({ index: r.index, message: r.message });
    }
  }

  if (created.length > 0) {
    revalidateTag(PROFILES_CACHE_TAG);
  }

  return { created, errors };
}
