/** Client/server shared type voor Mijn profiel. */
export type UserMyProfile = {
  id: string;
  email: string;
  naam: string;
  leeftijd: number;
  profilePhotoUrl: string | null;
  profileBio: string;
  profileHobbies: string[];
  profileLocation: string;
  zoekEigenschappen: string[];
};
