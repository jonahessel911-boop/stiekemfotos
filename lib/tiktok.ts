export const TIKTOK_PIXEL_ID = "D7QVTVBC77UEKU3PUHMG";
export const TIKTOK_ACCESS_TOKEN = "c761e1e98194b3da6ec63a31b524d0d267205733";
export const TIKTOK_TRACK_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

export type TikTokTrackEvent =
  | "ViewContent"
  | "CompleteRegistration"
  | "SubmitForm"
  | "SubmitApplication";
