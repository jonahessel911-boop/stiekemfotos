/** Deterministisch ~60% van profielen als "online" in de UI (marketing), op basis van id. */
export function isProfileDisplayedOnline(profileId: string): boolean {
  let h = 0;
  for (let i = 0; i < profileId.length; i++) {
    h = (Math.imul(31, h) + profileId.charCodeAt(i)) | 0;
  }
  const u = h >>> 0;
  return u % 100 < 60;
}
