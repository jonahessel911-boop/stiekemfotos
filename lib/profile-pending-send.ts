/** Eerste bericht vanaf profielpagina → chat opent meteen, versturen gebeurt op /berichten. */

export const PROFILE_PENDING_SEND_KEY = "dm_profile_pending_send_v1";

/** Voorkomt dubbele verzending (o.a. React Strict Mode). */
export const PROFILE_PENDING_LOCK_KEY = "dm_profile_pending_send_lock_v1";

export type ProfilePendingSend = {
  conversationId: string;
  text: string;
  noCredits?: boolean;
};
