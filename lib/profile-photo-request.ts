/**
 * "Start chat" vanaf een profiel pre-vult NIET langer een fotoverzoek.
 * De gebruiker kiest zelf uit een opener (zie CONVERSATION_STARTER_OPTIONS) of typt iets.
 */

export const DEFAULT_PHOTO_REQUEST_DRAFT = '';

export const CONVERSATION_STARTER_OPTIONS = [
  'Hoi, hoe is het?',
  'Hee alles goed?',
  'Hoi mooie vrouw!',
] as const;

export const PROFILE_PHOTO_REQUEST_NAV_KEY = 'dm_profile_photo_request_nav_v1';

export type ProfilePhotoRequestNavPayload = {
  profileId: string;
  draft: string;
};
