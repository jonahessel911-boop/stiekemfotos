import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BUCKET = "profiles";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn verplicht.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const femaleNames = [
  "Alina","Elena","Sofia","Natalia","Anastasia","Diana","Ioana","Katerina","Mila","Irina",
  "Karina","Viktoria","Larisa","Nadia","Tatiana","Yulia","Ivana","Oksana","Marta","Nina",
  "Bianca","Lilia","Veronika","Kristina","Milena","Polina","Anya","Ilona","Sabina","Renata",
  "Camelia","Teodora","Monika","Daria","Ludmila","Simona","Aurelia","Olga","Larysa","Tamara",
  "Inna","Alisa","Roksana","Violeta","Adelina","Marina","Daniela","Ecaterina","Klaudia","Zlata",
];

/** Woonplaats in de app: Nederlandse steden (data / persona-achtergrond blijft oost-Europees). */
const nlCities = [
  "Amsterdam", "Rotterdam", "Utrecht", "Den Haag", "Eindhoven", "Groningen",
  "Tilburg", "Almere", "Breda", "Nijmegen", "Haarlem", "Arnhem", "Maastricht",
  "Leiden", "Zwolle", "Enschede", "Apeldoorn", "Amersfoort", "Hilversum", "Delft",
  "Venlo", "Deventer", "Roosendaal", "Schiedam", "Zaanstad",
];

const heritagePool = [
  "Roemenië", "Oekraïne", "Bulgarije", "Polen", "Hongarije", "Moldavië",
  "Slowakije", "Servië", "Kroatië", "Litouwen",
];

const interestsPool = [
  "koffie dates","latin dans","pilates","weekendtrips","rode wijn","mode","fotografie",
  "lange wandelingen","boeken","spa","cocktails","jazz bars","yoga","interieur","roadtrips",
  "thuis koken","concerten","strand","hiken","city breaks","kunst","sushi","selfcare","flirten",
];

const bios = [
  "warm, speels en nieuwsgierig. ik hou van lange blikken en korte geheime afspraken.",
  "zacht van buiten, ondeugend van binnen. ik val op humor en zelfvertrouwen.",
  "ik ben spontaan, vrouwelijk en een tikje mysterieus. verras me met iets origineels.",
  "ik zoek spanning met een echte klik. geen drama, wel chemie.",
  "lief, direct en soms gevaarlijk flirterig. als jij lef hebt, heb ik aandacht.",
];

const imageSources = Array.from(
  { length: 90 },
  (_, i) => `https://randomuser.me/api/portraits/women/${i + 1}.jpg`
);

function buildUniqueAvatarSources(total) {
  const out = [];
  for (let i = 0; i < total; i += 1) {
    out.push(imageSources[i % imageSources.length]);
  }
  return out;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickNInterests(seed, n) {
  const arr = [];
  for (let i = 0; i < n; i += 1) {
    arr.push(interestsPool[(seed + i * 3) % interestsPool.length]);
  }
  return [...new Set(arr)];
}

function buildSystemPrompt(profile) {
  return [
    "je bent een oost-europese vrouw op discreetemeisjes.nl.",
    "schrijf in kleine letters, korte zinnen, warm en speels.",
    "toon: direct, vrouwelijk, licht ondeugend, nooit afstandelijk of saai.",
    "gebruik af en toe emoji (max 1 per bericht), blijf natuurlijk.",
    "stel vaak een korte vraag terug en houd tempo in het gesprek.",
    "geen expliciete afspraken te snel; bouw spanning op met flirt en mysterie.",
    `profiel-context: naam ${profile.first_name}, ${profile.age}, woont in ${profile.city} (Nederland), achtergrond ${profile.heritage}.`,
    `karakter: ${profile.personality}.`,
  ].join(" ");
}

async function ensureBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`Buckets ophalen mislukt: ${error.message}`);
  if (buckets.some((b) => b.name === BUCKET)) return;
  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  });
  if (createError) throw new Error(`Bucket maken mislukt: ${createError.message}`);
}

async function uploadFromUrl(profileSlug, index, sourceUrl) {
  let source = sourceUrl;
  let res = await fetch(source);
  if (!res.ok) {
    source = imageSources[(index * 7 + profileSlug.length) % imageSources.length];
    res = await fetch(source);
  }
  if (!res.ok) throw new Error(`Image fetch mislukt (${res.status}) voor ${source}`);
  const type = res.headers.get("content-type") || "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const arrayBuffer = await res.arrayBuffer();
  const path = `${profileSlug}/photo-${index + 1}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, {
    contentType: type,
    upsert: true,
  });
  if (error) throw new Error(`Upload mislukt voor ${path}: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function run() {
  await ensureBucket();

  const profiles = femaleNames.map((firstName, i) => {
    const city = nlCities[i % nlCities.length];
    const country = "Nederland";
    const heritage = heritagePool[i % heritagePool.length];
    const age = 21 + (i % 12);
    const photosCount = 4 + (i % 3);
    const slug = `${slugify(firstName)}-${i + 1}`;
    const personality =
      "warm, direct, speels en vrouwelijk. licht ondeugend, veel oogcontact in tekst, oost-europese flair.";
    const interests = pickNInterests(i, 6 + (i % 3));
    const bio = bios[i % bios.length];
    return {
      slug,
      first_name: firstName,
      age,
      city,
      country,
      heritage,
      bio,
      interests,
      personality,
      voice_language: ["ro", "uk", "pl", "bg"][i % 4],
      photosCount,
    };
  });
  const avatarSources = buildUniqueAvatarSources(profiles.length);

  for (const [profileIndex, p] of profiles.entries()) {
    const photoUrls = [];
    for (let i = 0; i < p.photosCount; i += 1) {
      const source =
        i === 0
          ? avatarSources[profileIndex % avatarSources.length]
          : imageSources[(photoUrls.length + p.age + i) % imageSources.length];
      const uploaded = await uploadFromUrl(p.slug, i, source);
      photoUrls.push(uploaded);
    }

    const systemPrompt = buildSystemPrompt({ ...p, first_name: p.first_name });
    const row = {
      slug: p.slug,
      first_name: p.first_name,
      age: p.age,
      city: p.city,
      country: p.country,
      bio: p.bio,
      interests: p.interests,
      personality: p.personality,
      system_prompt: systemPrompt,
      avatar_url: photoUrls[0],
      photo_urls: photoUrls,
      voice_language: p.voice_language,
      heritage: p.heritage,
      is_active: true,
    };

    const { data: inserted, error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "slug" })
      .select("id")
      .single();
    if (error) throw new Error(`Profile upsert mislukt (${p.slug}): ${error.message}`);

    const mediaRows = photoUrls.map((url, idx) => ({
      profile_id: inserted.id,
      media_type: "image",
      url,
      sort_order: idx,
    }));

    await supabase.from("profile_media").delete().eq("profile_id", inserted.id);
    const { error: mediaErr } = await supabase.from("profile_media").insert(mediaRows);
    if (mediaErr) throw new Error(`Profile media insert mislukt (${p.slug}): ${mediaErr.message}`);
  }

  console.log("Klaar: 50 profiles geupsert + media in Supabase Storage.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
