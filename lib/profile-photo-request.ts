/**
 * "Start chat" vanaf een profiel — geen vooraf ingevulde tekst; gebruiker typt zelf.
 */

export const DEFAULT_PHOTO_REQUEST_DRAFT = '';

export const PROFILE_PHOTO_REQUEST_NAV_KEY = 'dm_profile_photo_request_nav_v1';

export type ProfilePhotoRequestNavPayload = {
  profileId: string;
  draft: string;
};
