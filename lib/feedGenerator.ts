import { pickRandomCity } from "@/lib/cities";
import type { Post } from "@/lib/mockData";
import type { Profile } from "@/lib/types/profile";
const FEED_POST_COUNT = 50;

const REACTION_NAMES = [
  "Anoniem",
  "Bezoeker",
  "Milan",
  "Sven",
  "Rico",
  "Daan",
  "Kevin",
  "Sam",
  "Jordy",
  "Lex",
  "Tom",
  "Niels",
  "Bas",
  "Luuk",
  "Tim",
  "Ruben",
  "Jesse",
  "Finn",
  "Thijs",
  "Sem",
];

const TIME_LABELS = [
  "zojuist",
  "2 min geleden",
  "8 min geleden",
  "24 min geleden",
  "1u geleden",
  "2u geleden",
  "4u geleden",
  "gisteren",
  "gisteravond",
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function interestHint(p: Profile): string {
  const i = p.interests?.filter(Boolean) ?? [];
  if (i.length === 0) return "koffie";
  return pick(i).toLowerCase();
}

function captionPool(p: Profile, city: string): string[] {
  const name = p.name;
  const loc = p.location || city;
  const heritage = p.heritage ? ` (${p.heritage})` : "";
  const hobby = interestHint(p);
  return [
    `Ik heb vanavond niks te doen… iemand zin om in ${loc} af te spreken? 😉`,
    `Vrij vanavond in ${loc} — wie heeft er zin in een drankje en meer? 💋`,
    `Alleen op de bank is zo saai. Wie triggert me vandaag?`,
    `Geen plannen vanavond. Discreet iets drinken in ${loc}? Stuur me een bericht.`,
    `Korte check: ben ik de enige die vandaag extra ondeugend wakker werd? 😏`,
    `Ik zoek iemand die me laat lachen en een beetje uitdaagt.`,
    `Spontane vraag: wie durft me als eerste een onverwacht bericht te sturen?`,
    `Net terug van sporten en nu zin in wat aandacht…`,
    `Vandaag voel ik me gevaarlijk gezellig. Wie past daarbij?`,
    `Ik heb net een nieuwe foto gemaakt maar twijfel of ik 'm moet sturen 🙈`,
    `${name} zoekt iemand met pit en humor. Bestaat die hier?`,
    `Soms wil ik gewoon iemand die direct is. Niet eindeloos appen.`,
    `Koffie, chaos en een beetje chemie — wie oefent met me ${hobby}? ☕`,
    `Ik wil geen standaard smalltalk. Verras me met iets doms of iets stouts.`,
    `Weekendmodus: geen verplichtingen, wel zin in spanning${heritage}.`,
    `Als je durft: stuur geen "hey" maar iets waar ik om moet glimlachen.`,
    `Net mijn nagels gedaan en nu wil ik ze ergens anders laten zien 😇`,
    `Ik ben in ${loc} en ik voel me… gevaarlijk goed vandaag.`,
    `Lange dag gehad. Ik wil iemand die me laat vergeten dat het maandag was.`,
    `Discreet blijft discreet — maar flirterig mag wél.`,
    `Wie heeft er zin in een geheimpje tussen ons twee?`,
    `Ik ben niet op zoek naar perfect. Wel naar eerlijk en een beetje wild.`,
    `Playlist staat op "te veel gevoel" — match jij die vibe?`,
    `Vandaag: zachte stem, harde blik. Probeer maar eens bij te houden.`,
    `Als jij typfouten maakt maar wél lef hebt: je hebt al punten.`,
  ];
}

/** Extra korte statusregels (mix NL + algemene vibe) voor 50+ unieke combinaties. */
const EXTRA_STATUS_LINES = [
  "Liever één goed gesprek dan honderd saaie chats.",
  "Ik hou van mensen die durven te zeggen wat ze willen.",
  "Vandaag wil ik gewoon… spanning zonder drama.",
  "Als je serieus bent: stuur iets originieels. Anders swipe ik door.",
  "Geen sprookjes, wel chemie.",
  "Ik zoek warmte, humor en een beetje gevaar 😉",
  "Soms is stilte ook een antwoord — maar vandaag niet.",
  "Wie heeft er zin in een geheime afspraak ergens in de stad?",
  "Ik ben kieskeurig, maar niet onbereikbaar.",
  "Lachen tot je buik pijn doet — dat mis ik soms.",
  "Geen ghosting energy hier graag.",
  "Ik val op charisma, niet op pose.",
  "Vandaag: open voor iets nieuws.",
  "Als je braaf bent, verveel ik me. Sorry niet sorry.",
  "Ik wil iemand die me raakt zonder drama.",
  "Discreet betekent voor mij: respect + plezier.",
  "Geen perfecte timing, wel oprechte interesse.",
  "Ik ben nieuwsgierig naar jouw slechtste grap.",
  "Flirten mag. Plagen ook. Saai? Nee.",
  "Als je kunt koken: bonuspunten. Als je kunt luisteren: nog meer.",
  "Ik zoek geen redder, wel een medeplichtige.",
  "Vandaag voel ik me extra zacht en extra stout tegelijk.",
  "Wie durft eerlijk te zijn over wat-ie zoekt?",
  "Ik heb zin in iets dat niet op Instagram hoeft.",
  "Geen rush — wel richting.",
  "Als jij subtiel bent, moet ik misschien mijn bril op 🔥",
  "Ik wil spanning die voelt als thuiskomen.",
  "Soms wil ik gewoon gek doen zonder uitleg.",
  "Geen checklist-liefde. Wel vibe.",
  "Ik ben hier voor echte mensen, geen rollenspel.",
  "Als je mij kunt laten glimlachen: je wint al de helft.",
  "Vandaag: minder praten, meer voelen (of andersom).",
  "Ik zoek iemand die durft te kiezen.",
  "Geen perfecte foto’s nodig — wel echte intentie.",
  "Ik hou van kleine details: hoe je typt, hoe je lacht.",
  "Als je serieus flirt: maak me nieuwsgierig.",
  "Ik wil iets dat voelt als een geheim tussen ons.",
  "Geen games — tenzij ze leuk zijn 😏",
  "Vandaag ben ik in de stemming voor avontuur.",
  "Ik zoek warmte zonder verplichtingen op voorhand.",
  "Als je direct bent: respect. Als je lief bent: nog meer.",
  "Ik wil lachen tot het te laat is.",
  "Geen standaard openingszinnen — verras me.",
  "Ik ben hier voor connectie, niet voor ego.",
  "Soms is het simpel: goede energie, goede nacht.",
  "Ik val op lef en zachtheid in één pakket.",
  "Vandaag wil ik iemand die me uitdaagt om eerlijk te zijn.",
  "Geen perfect plan — wel goede intenties.",
  "Ik zoek iemand die weet wat hij wil (of het durft te ontdekken).",
  "Als je mij serieus neemt: ik neem jou ook serieus.",
  "Ik wil chemie die je niet hoeft uit te leggen.",
] as const;

function commentPool(p: Profile, city: string): string[] {
  const loc = p.location || city;
  return [
    "Wow 😍",
    "Jij bent echt knap",
    "Die blik 😮‍💨",
    "Leuke vibe!",
    "Heel nice foto",
    `Ik ben ook in de buurt van ${loc}...`,
    "Stuur me even 👀",
    "Dit is echt een sterke post",
    "Haha love this energy",
    "Te mooi om waar te zijn 😅",
    "Ik zou zo met je willen kletsen",
    "Discreet maar wel duidelijk 😉",
    "Respect voor deze post",
    "Oke nu wil ik meer zien",
    "Dit triggert me op de goede manier",
    "Haha same energy",
    "Oprecht: dit is sterk geschreven",
    "Ik zou hierop reageren met een drankje 😉",
    "Chill vibe",
    "Dit voelt echt",
    "Top post, punt.",
    "Hier kan ik wel achter staan",
    "Mooi gezegd",
    "Snap ik helemaal",
  ];
}

/**
 * Genereert feed-posts alleen uit de meegegeven profielen (bijv. Supabase).
 * Lege lijst = geen posts (geen mock-fallback).
 * Altijd `FEED_POST_COUNT` tekst-only kaarten (geen hoofdafbeelding); profielen worden hergebruikt als er minder zijn.
 */
export function generateFeedPosts(sourceProfiles: Profile[]): Post[] {
  const pool = sourceProfiles;
  if (pool.length === 0) return [];

  const rotated = shuffle(pool);
  const captionChoices = [...EXTRA_STATUS_LINES];

  const posts: Post[] = [];
  for (let i = 0; i < FEED_POST_COUNT; i++) {
    const p = rotated[i % rotated.length]!;
    const city = pickRandomCity();
    const loc = (p.location && p.location.trim()) || city;
    const captions = [...captionPool(p, loc), ...captionChoices];
    const comments = commentPool(p, loc);

    posts.push({
      id: `feed-${p.id}-${i}`,
      profileId: p.id,
      user: {
        name: p.name,
        avatar: p.photo,
        age: p.age,
        location: loc,
      },
      caption: pick(captions),
      likes: Math.floor(28 + Math.random() * 380),
      liked: false,
      timestamp: pick(TIME_LABELS),
      comments: [
        { user: pick(REACTION_NAMES), text: pick(comments) },
        { user: pick(REACTION_NAMES), text: pick(comments) },
      ],
    });
  }

  return shuffle(posts);
}
