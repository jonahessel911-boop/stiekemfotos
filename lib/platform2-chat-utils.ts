import type { ConversationSummary } from '@/lib/types/chat';
import { resolveProfileImageUrl } from '@/lib/profile-image-url';

export function formatP2MessageTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function avatarUrlForSummary(c: ConversationSummary): string {
  const u = resolveProfileImageUrl(c.previewAvatar);
  return u || '/logo-mark.png';
}
