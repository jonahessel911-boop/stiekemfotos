import { pickRandomCity } from "@/lib/cities";
import type { Post } from "@/lib/mockData";
import { allProfiles } from "@/lib/profiles";

const FLIRT_TEMPLATES = (city: string) => [
  `Ik heb vanavond niks te doen… iemand zin om in ${city} af te spreken? 😉`,
  `Vrij vanavond in ${city} — wie heeft er zin in een drankje en meer? 💋`,
  `Alleen op de bank is zo saai. Wie triggert me in ${city} vandaag?`,
  `Geen plannen vanavond in ${city}. Discreet iets drinken? Stuur me een bericht.`,
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function generateFeedPosts(): Post[] {
  const profiles = shuffle(allProfiles).slice(0, 6);
  const images = [
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&h=600&fit=crop",
    "https://images.unsplash.com/photo-1580489944761-09be1ec59862?w=800&h=600&fit=crop",
  ];

  return profiles.map((p, i) => {
    const city = pickRandomCity();
    const caption =
      FLIRT_TEMPLATES(city)[Math.floor(Math.random() * FLIRT_TEMPLATES(city).length)]!;
    return {
      id: `feed-${p.id}-${i}`,
      user: {
        name: p.name,
        avatar: p.photo,
        age: p.age,
        location: p.location,
      },
      image: images[i % images.length]!,
      caption,
      likes: Math.floor(20 + Math.random() * 180),
      liked: false,
      timestamp: `${1 + (i % 12)}u geleden`,
      comments: [
        { user: "Anoniem", text: "Wow 😍" },
        { user: "Bezoeker", text: `Ik ben ook in de buurt van ${city}…` },
      ],
    };
  });
}
