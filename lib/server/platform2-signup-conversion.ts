import {
  buildSvlTxidForUser,
  sendSvlPostback,
  SVL_CONVERSION_TYPE,
} from "@/lib/clickflare-postback";
import { findUserById, patchUserRecord } from "@/lib/server/users";

/**
 * ClickFlare-conversie direct na gratis signup op /platform/2/aanmaken.
 * Idempotent via user.clickflareSignupSentAt.
 */
export async function sendPlatform2SignupClickflareIfNeeded(
  userId: string,
  clickIdHint?: string
): Promise<{ sent: boolean; reason: string }> {
  const user = await findUserById(userId);
  if (!user) return { sent: false, reason: "user_not_found" };
  if (user.clickflareSignupSentAt) {
    return { sent: false, reason: "already_sent" };
  }

  const clickId = clickIdHint?.trim() || user.clickId?.trim();
  if (!clickId) {
    return { sent: false, reason: "no_click_id" };
  }

  const postback = await sendSvlPostback({
    clickId,
    txid: buildSvlTxidForUser(userId),
    payout: "0.00",
    ct: SVL_CONVERSION_TYPE,
    reason: "platform2_signup",
  });

  if (postback.fired && postback.ok) {
    await patchUserRecord(userId, {
      clickflareSignupSentAt: new Date().toISOString(),
    });
    return { sent: true, reason: "ok" };
  }

  return {
    sent: false,
    reason: postback.fired ? "postback_failed" : "skipped",
  };
}
