/** Standaardtekst voor “Vraag om foto” → chat met vooringevuld invoerveld. */

export const DEFAULT_PHOTO_REQUEST_DRAFT = 'kan je een nieuwe foto voor me maken schat?';

export const PROFILE_PHOTO_REQUEST_NAV_KEY = 'dm_profile_photo_request_nav_v1';

export type ProfilePhotoRequestNavPayload = {
  profileId: string;
  draft: string;
};
