const SESSION_KEY = "dm_show_welcome_modal";

export function markShowWelcomeModal() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_KEY, "1");
}

export function shouldShowWelcomeModal(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

export function clearWelcomeModalFlag() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}
