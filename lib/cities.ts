/** Random Dutch cities for playful feed posts */
export const NL_CITIES = [
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
  "Arnhem",
  "Maastricht",
  "Leiden",
  "Zwolle",
  "Enschede",
  "Apeldoorn",
  "Amersfoort",
  "Hilversum",
  "Delft",
] as const;

export function pickRandomCity(): string {
  return NL_CITIES[Math.floor(Math.random() * NL_CITIES.length)]!;
}
