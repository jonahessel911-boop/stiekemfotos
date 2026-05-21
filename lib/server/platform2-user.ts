import type { UserRecord } from "@/lib/server/users";

export const PLATFORM2_SIGNUP_SOURCE = "platform2" as const;

export function isPlatform2User(user: UserRecord | null | undefined): boolean {
  return user?.signupSource === PLATFORM2_SIGNUP_SOURCE;
}
