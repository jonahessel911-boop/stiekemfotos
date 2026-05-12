'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Navbar from '@/components/Navbar';
import {
  Search,
  Sparkles,
  CreditCard,
  ArrowRight,
  Check,
  CheckCheck,
  Mic,
  Play,
  Pause,
  ImagePlus,
  MoreVertical,
  X,
  Loader2,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ConversationSummary, Conversation, ChatMessage } from '@/lib/types/chat';
import { profilePhotoSrc } from '@/lib/profile-image-url';
import {
  getCreditsBalance,
  spendChatCredit,
  refundChatCredit,
  spendPhotoUnlock,
  canAffordPhotoUnlock,
  creditsCostForBatchSize,
  CREDITS_PER_MESSAGE,
  CREDITS_PER_PHOTO_UNLOCK,
  INITIAL_FREE_CREDITS,
} from '@/lib/credits-client';
import { useCreditsPricing } from '@/components/CreditsPricingProvider';
import {
  MAX_OUTGOING_BATCH_SIZE,
  MAX_USER_MESSAGE_CHARS,
} from '@/lib/chat-send-limits';
import {
  formatLastOnlineAgo,
  lastAssistantMessageAt,
  syntheticLastSeenMinutes,
} from '@/lib/peer-presence';
import { sortChatMessagesChronologically } from '@/lib/chat-message-order';
import {
  PROFILE_PENDING_LOCK_KEY,
  PROFILE_PENDING_SEND_KEY,
  type ProfilePendingSend,
} from '@/lib/profile-pending-send';
import {
  DEFAULT_PHOTO_REQUEST_DRAFT,
  PROFILE_PHOTO_REQUEST_NAV_KEY,
  type ProfilePhotoRequestNavPayload,
} from '@/lib/profile-photo-request';

function summaryActivityMs(c: ConversationSummary): number {
  return new Date(c.updatedAt || 0).getTime();
}

function formatMessageTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatVoiceDuration(durationMs?: number): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return '0:05';
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatRecordingDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
}

/** Typing-indicator meteen na verzenden; server-latency is al genoeg “wachttijd”. */
function typingIndicatorDelayMs(_approxServerMessageCount: number): number {
  void _approxServerMessageCount;
  return 0;
}

function isEmailVerificationError(message: string | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('verifieer je e-mail') ||
    lower.includes('verifieer eerst je e-mail')
  );
}

/** Robust deduplication: match by ID first, then by content + time proximity for optimistic vs server messages. */
function deduplicateMessages(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const signatureToId = new Map<string, string>();
  const canonicalToLocalId = new Map<string, string>();
  const now = Date.now();
  const OPTIMISTIC_MERGE_WINDOW_MS = 45_000;

  const canonicalKeyFor = (m: ChatMessage): string => {
    const contentKey = (m.content || '').trim().toLowerCase();
    const replyKey = (m.replyToId || '').trim().toLowerCase();
    const img = m.imageFile ? 'img1' : 'img0';
    const gift = m.gift ? `gift:${m.gift.direction}:${m.gift.credits}` : 'gift:none';
    return `${m.role}|${contentKey}|${replyKey}|${img}|${gift}`;
  };

  for (const msg of messages) {
    const contentKey = (msg.content || '').trim().toLowerCase();
    const msgTime = Date.parse(msg.createdAt);
    const timeKey = Math.floor((Number.isFinite(msgTime) ? msgTime : now) / 3000); // 3s bucket
    const signature = `${msg.role}:${contentKey}:${timeKey}`;

    const existingIdForSignature = signatureToId.get(signature);
    if (existingIdForSignature) {
      const existing = byId.get(existingIdForSignature);
      if (existing) {
        // Prefer server message (non-local ID) over optimistic/local one.
        if (!msg.id.startsWith('local-') && existing.id.startsWith('local-')) {
          byId.delete(existing.id);
          byId.set(msg.id, msg);
          signatureToId.set(signature, msg.id);
        }
        continue;
      }
    }

    if (byId.has(msg.id)) continue;

    // Extra guard: collapse optimistic local-* with server-ack message
    // even when createdAt differs by more than 3s.
    const canonical = canonicalKeyFor(msg);
    const isLocal = msg.id.startsWith('local-');
    if (isLocal) {
      if (!canonicalToLocalId.has(canonical)) {
        canonicalToLocalId.set(canonical, msg.id);
      }
    } else {
      const localId = canonicalToLocalId.get(canonical);
      if (localId) {
        const localMsg = byId.get(localId);
        if (localMsg) {
          const localTime = Date.parse(localMsg.createdAt);
          const serverTime = Number.isFinite(msgTime) ? msgTime : now;
          const localTs = Number.isFinite(localTime) ? localTime : now;
          if (Math.abs(serverTime - localTs) <= OPTIMISTIC_MERGE_WINDOW_MS) {
            byId.delete(localId);
            canonicalToLocalId.delete(canonical);
          }
        }
      }
    }

    byId.set(msg.id, msg);
    if (contentKey) signatureToId.set(signature, msg.id);
  }

  return Array.from(byId.values());
}

function MessageTimestamp({
  iso,
  align,
  variant,
}: {
  iso: string;
  align: 'left' | 'right';
  /** incoming = grijs links; outgoing-meta = onder roze bubble op chat-achtergrond (leesbaar grijs) */
  variant: 'incoming' | 'outgoing-meta';
}) {
  const t = formatMessageTime(iso);
  if (!t) return null;
  return (
    <p
      className={`mt-1 text-[11px] font-medium tabular-nums px-0.5 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${variant === 'outgoing-meta' ? 'text-gray-600' : 'text-gray-500'}`}
    >
      {t}
    </p>
  );
}

function snippetForReply(m: ChatMessage | undefined): string {
  if (!m) return '';
  if (m.gift) return `${m.gift.emoji ?? '🎁'} ${m.gift.credits} credits`;
  if (m.imageFile) {
    if (m.role === 'assistant' && m.photoLock && !m.photoLock.unlockedAt) {
      return '🔒 vergrendelde foto';
    }
    return (m.content ?? '').trim() ? `📷 ${(m.content ?? '').trim()}` : '📷 foto';
  }
  const t = (m.content ?? '').trim();
  return t.length > 110 ? `${t.slice(0, 110)}…` : t;
}

type LiveNotification = {
  id: string;
  profileName: string;
  avatar: string;
  text: string;
};

const CHAT_GIFT_OPTIONS = [
  { id: 'mini', credits: 75, priceLabel: '€5,99', featured: false },
  { id: 'starter', credits: 125, priceLabel: '€9,99', featured: false },
  { id: 'best', credits: 250, priceLabel: '€13,99', featured: true },
] as const;

function BerichtenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatParam = searchParams.get('chat');
  const profileOpenParam = searchParams.get('profile');

  const [list, setList] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(chatParam);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  /** Per gesprek: parallel versturen naar andere chats blijft mogelijk. */
  const [inflightSends, setInflightSends] = useState(() => new Set<string>());
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [typingVisibleAtByConv, setTypingVisibleAtByConv] = useState<Record<string, number>>({});
  const [sendStartedAtByConv, setSendStartedAtByConv] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const visibleError = isEmailVerificationError(error) ? null : error;
  const [query, setQuery] = useState('');
  /** Lokaal: meerdere bubbles vóór één server-roundtrip (debounce). */
  const [optimisticBatch, setOptimisticBatch] = useState<ChatMessage[]>([]);
  const [optimisticConversationId, setOptimisticConversationId] = useState<string | null>(
    null
  );
  const [optimisticImageById, setOptimisticImageById] = useState<Record<string, string>>({});
  /** Gesprek waar de huidige debounce-batch naartoe gaat (kan afwijken van selectedId tijdens zeldzame races). */
  const outgoingConversationIdRef = useRef<string | null>(null);
  const outgoingAccumRef = useRef<
    Array<{
      text: string;
      image?: { base64: string; mime: string; previewUrl: string };
      replyToId?: string;
    }>
  >([]);
  const batchFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingImage, setPendingImage] = useState<{
    base64: string;
    mime: string;
    previewUrl: string;
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const focusComposerAfterProfileOpenRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<any>(null);
  const speechTranscriptRef = useRef<string>('');
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceDraftBlob, setVoiceDraftBlob] = useState<Blob | null>(null);
  const [voiceDraftTranscript, setVoiceDraftTranscript] = useState('');
  const [localVoiceUrlById, setLocalVoiceUrlById] = useState<Record<string, string>>({});
  const localVoiceUrlByIdRef = useRef<Record<string, string>>({});
  const [showGiftPanel, setShowGiftPanel] = useState(false);
  const [giftNote, setGiftNote] = useState('ik vind je leuk');
  const [creditsBalance, setCreditsBalance] = useState(INITIAL_FREE_CREDITS);
  const { openPricing } = useCreditsPricing();
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  /** Welk gesprek de huidige niet-zachte fetch laadt (legacy + sync met cache). */
  const loadingConversationIdRef = useRef<string | null>(null);
  /** Elke nieuwe harde fetch verhoogt dit; alleen de **laatste** fetch mag de spinner uitzetten (race bij snel tab-wisselen). */
  const conversationFetchGenerationRef = useRef(0);
  /** Cache per conversation id voor instant openen zonder verkeerde mix. */
  const conversationCacheRef = useRef<Record<string, Conversation>>({});
  /** Tot deze tijd (epoch ms) tonen we “Online” na jouw bericht / haar antwoord. */
  const [peerOnlineUntil, setPeerOnlineUntil] = useState<number | null>(null);
  const [arrivalToast, setArrivalToast] = useState<string | null>(null);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [uiNow, setUiNow] = useState(() => Date.now());
  const onlineDelayTimerRef = useRef<number | null>(null);
  const arrivalToastTimerRef = useRef<number | null>(null);
  const conversationProfileNameRef = useRef<string>('Ze');
  const listRef = useRef<ConversationSummary[]>([]);
  const messagesLenByConvRef = useRef<Record<string, number>>({});
  const optimisticConversationIdRef = useRef<string | null>(null);
  /** Synchronous guard to block rapid double-send before React state updates land. */
  const sendGuardByConvRef = useRef<Set<string>>(new Set());
  const [openedGiftByMessageId, setOpenedGiftByMessageId] = useState<Record<string, boolean>>({});
  const [giftClosedAnimationUrl, setGiftClosedAnimationUrl] = useState<string | null>(null);
  const [giftOpenAnimationUrl, setGiftOpenAnimationUrl] = useState<string | null>(null);
  const [giftOpenPlayedByMessageId, setGiftOpenPlayedByMessageId] = useState<
    Record<string, boolean>
  >({});
  const lastSendFingerprintRef = useRef<{ key: string; at: number } | null>(null);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const swipeStartRef = useRef<{ messageId: string; x: number; y: number } | null>(null);
  const [swipeOffsetByMessageId, setSwipeOffsetByMessageId] = useState<Record<string, number>>({});
  const [liveNotifications, setLiveNotifications] = useState<LiveNotification[]>([]);

  /** Vergrendelde foto's per bericht-id; key = messageId, value = busy/unlocking. */
  const [unlockingByMessageId, setUnlockingByMessageId] = useState<Record<string, boolean>>({});
  /** Lokaal: foto's die deze sessie al ontgrendeld zijn (ook als server nog niet gepolld is). */
  const [locallyUnlockedByMessageId, setLocallyUnlockedByMessageId] = useState<Record<string, boolean>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!lightboxSrc) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxSrc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [lightboxSrc]);

  const openGiftMessage = useCallback((messageId: string) => {
    setOpenedGiftByMessageId((prev) => (prev[messageId] ? prev : { ...prev, [messageId]: true }));
  }, []);

  const handleReplySwipeStart = useCallback(
    (messageId: string, e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      swipeStartRef.current = { messageId, x: e.clientX, y: e.clientY };
      setSwipeOffsetByMessageId((prev) => ({ ...prev, [messageId]: 0 }));
    },
    []
  );

  const handleReplySwipeMove = useCallback(
    (messageId: string, e: React.PointerEvent<HTMLDivElement>) => {
      const s = swipeStartRef.current;
      if (!s || s.messageId !== messageId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      // Keep vertical scrolling natural; only react on mostly-horizontal swipes.
      if (Math.abs(dy) > Math.max(14, Math.abs(dx))) return;
      const clamped = Math.max(-82, Math.min(82, dx));
      setSwipeOffsetByMessageId((prev) => ({ ...prev, [messageId]: clamped }));
    },
    []
  );

  const handleReplySwipeEnd = useCallback((messageId: string) => {
    const s = swipeStartRef.current;
    const offset = swipeOffsetByMessageId[messageId] ?? 0;
    if (s?.messageId === messageId && Math.abs(offset) >= 62) {
      setReplyToId(messageId);
    }
    swipeStartRef.current = null;
    setSwipeOffsetByMessageId((prev) => {
      if (!(messageId in prev)) return prev;
      const { [messageId]: _removed, ...rest } = prev;
      return rest;
    });
  }, [swipeOffsetByMessageId]);

  const pushLiveNotification = useCallback((profileName: string, avatar: string, text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const n: LiveNotification = { id, profileName, avatar, text };
    setLiveNotifications((prev) => [...prev.slice(-3), n]);
    window.setTimeout(() => {
      setLiveNotifications((prev) => prev.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch('/api/animations/gift_closed'),
          fetch('/api/animations/gift_open'),
        ]);
        const d1 = (await r1.json()) as { url?: string | null };
        const d2 = (await r2.json()) as { url?: string | null };
        if (!cancel) {
          // Always keep a local fallback path so gift animation can still render
          // when admin URLs are missing.
          setGiftClosedAnimationUrl(d1.url || '/api/animations/file/gift_closed');
          setGiftOpenAnimationUrl(d2.url || '/api/animations/file/gift_open');
        }
      } catch {
        if (!cancel) {
          setGiftClosedAnimationUrl(null);
          setGiftOpenAnimationUrl(null);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    // Light background "activity" nudges on desktop.
    const id = window.setInterval(() => {
      const pool = listRef.current;
      if (pool.length === 0) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (!pick) return;
      const msgs = [
        `${pick.profileName} is online`,
        `${pick.profileName} bekijkt je profiel`,
      ];
      pushLiveNotification(
        pick.profileName,
        pick.previewAvatar,
        msgs[Math.floor(Math.random() * msgs.length)] ?? `${pick.profileName} is online`
      );
    }, 95_000);
    return () => window.clearInterval(id);
  }, [pushLiveNotification]);

  const applyOptimisticListPreview = useCallback(
    (convId: string, messageText: string, createdAtIso: string) => {
      const preview = messageText.trim() || '📷';
      const hhmm = formatMessageTime(createdAtIso);
      setList((prev) => {
        const next = prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                lastMessage: preview,
                lastMessageFromAssistant: false,
                timestamp: hhmm || c.timestamp,
                updatedAt: createdAtIso,
              }
            : c
        );
        listRef.current = next;
        return next;
      });
    },
    []
  );

  const fetchList = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingList(true);
    try {
      const res = await fetch('/api/conversations', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Laden mislukt');
      setList(data.conversations);
      listRef.current = data.conversations as ConversationSummary[];
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout bij laden inbox');
    } finally {
      if (!opts?.silent) setLoadingList(false);
    }
  }, []);

  const fetchConversation = useCallback(async (id: string, opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    let generationAtStart = 0;
    if (!soft) {
      generationAtStart = ++conversationFetchGenerationRef.current;
      loadingConversationIdRef.current = id;
      setLoadingMessages(true);
    }
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(28_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gesprek niet gevonden');
      if (selectedIdRef.current !== id) return;
      const incoming = data.conversation as Conversation | undefined;
      if (!incoming) {
        setConversation(null);
        return;
      }
      conversationCacheRef.current[id] = incoming;
      /** Zacht verversen: GET kan net achterlopen op POST; behoud berichten die de server nog niet teruggeeft. */
      if (soft) {
        setConversation((prev) => {
          if (!prev || prev.id !== id) return incoming;
          const incomingIds = new Set(incoming.messages.map((m) => m.id));
          const carryOver = prev.messages.filter((m) => !incomingIds.has(m.id));
          if (carryOver.length === 0) return incoming;

          const merged = [...incoming.messages, ...carryOver];
          return {
            ...incoming,
            messages: sortChatMessagesChronologically(deduplicateMessages(merged)),
            updatedAt:
              new Date(incoming.updatedAt).getTime() >= new Date(prev.updatedAt).getTime()
                ? incoming.updatedAt
                : prev.updatedAt,
          };
        });
      } else {
        setConversation(incoming);
      }
    } catch (e) {
      if (selectedIdRef.current !== id) return;
      // Only surface hard-load timeouts/errors to the user; soft polls should fail silently.
      if (!soft) {
        const msg =
          e instanceof Error && e.name === 'TimeoutError'
            ? 'Gesprek laden duurt te lang. Probeer opnieuw.'
            : e instanceof Error
              ? e.message
              : 'Fout';
        setError(msg);
      }
    } finally {
      if (
        !soft &&
        generationAtStart > 0 &&
        generationAtStart === conversationFetchGenerationRef.current
      ) {
        loadingConversationIdRef.current = null;
        setLoadingMessages(false);
      }
    }
  }, []);

  const handleUnlockPhoto = useCallback(
    async (m: ChatMessage) => {
      if (!selectedId) return;
      if (!m.photoLock || m.photoLock.unlockedAt || locallyUnlockedByMessageId[m.id]) return;
      const cost = m.photoLock.credits ?? CREDITS_PER_PHOTO_UNLOCK;
      if (unlockingByMessageId[m.id]) return;

      if (getCreditsBalance() < cost) {
        openPricing();
        return;
      }

      setUnlockingByMessageId((prev) => ({ ...prev, [m.id]: true }));
      spendPhotoUnlock(cost);

      try {
        const res = await fetch(
          `/api/conversations/${selectedId}/messages/${m.id}/unlock`,
          {
            method: 'POST',
            credentials: 'include',
          }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          alreadyUnlocked?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || 'Foto ontgrendelen mislukt');
        if (data.alreadyUnlocked) {
          refundChatCredit(cost);
        }
        setLocallyUnlockedByMessageId((prev) => ({ ...prev, [m.id]: true }));
        await fetchConversation(selectedId, { soft: true });
      } catch (e) {
        refundChatCredit(cost);
        setError(e instanceof Error ? e.message : 'Foto ontgrendelen mislukt');
      } finally {
        setUnlockingByMessageId((prev) => {
          const { [m.id]: _omit, ...rest } = prev;
          return rest;
        });
      }
    },
    [
      selectedId,
      locallyUnlockedByMessageId,
      unlockingByMessageId,
      openPricing,
      fetchConversation,
    ]
  );

  useEffect(() => {
    const sync = () => {
      setCreditsBalance(getCreditsBalance());
      const sid = selectedIdRef.current;
      if (sid) {
        void fetchConversation(sid, { soft: true });
      }
      /** Geen parallelle inbox-GET tijdens profiel→chat bootstrap (race met POST overschrijft list). */
      if (!profileOpenParam?.trim()) {
        void fetchList({ silent: true });
      }
    };
    sync();
    window.addEventListener('dm-credits-updated', sync);
    return () => window.removeEventListener('dm-credits-updated', sync);
  }, [fetchConversation, fetchList, profileOpenParam]);

  useEffect(() => {
    const onPurchased = () => {
      const sid = selectedIdRef.current;
      if (sid) {
        void fetchConversation(sid, { soft: true });
      }
      if (!profileOpenParam?.trim()) {
        void fetchList({ silent: true });
      }
    };
    window.addEventListener('dm-credits-purchased', onPurchased);
    return () => window.removeEventListener('dm-credits-purchased', onPurchased);
  }, [fetchConversation, fetchList, profileOpenParam]);

  useEffect(() => {
    /** Profiel-deep-link flow doet zelf POST + fetchList; concurrente mount-fetch overschrijft soms die state. */
    if (profileOpenParam?.trim()) return;
    fetchList();
  }, [fetchList, profileOpenParam]);

  useEffect(() => {
    const id = window.setInterval(() => setPresenceNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Reduced from 1s to 5s to prevent constant full-component re-renders while page is open.
  // This was a major source of lag on tab switching and chat navigation. For ultra-smooth live timers,
  // consider extracting OnlineStatus / TypingIndicator into isolated components with their own RAF/interval.
  useEffect(() => {
    const id = window.setInterval(() => setUiNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setPeerOnlineUntil(null);
    setArrivalToast(null);
    if (onlineDelayTimerRef.current) {
      window.clearTimeout(onlineDelayTimerRef.current);
      onlineDelayTimerRef.current = null;
    }
    if (arrivalToastTimerRef.current) {
      window.clearTimeout(arrivalToastTimerRef.current);
      arrivalToastTimerRef.current = null;
    }
  }, [selectedId]);

  useEffect(() => {
    setReplyToId(null);
  }, [selectedId]);

  useEffect(() => {
    if (chatParam) setSelectedId(chatParam);
  }, [chatParam]);

  const openingProfileDeepLink = Boolean(profileOpenParam?.trim() && !chatParam);
  const profileDeepLinkBooting = openingProfileDeepLink && !selectedId;

  useEffect(() => {
    const pid = profileOpenParam?.trim();
    if (!pid) return;

    // Always handle profile deep link, even if chatParam is already present
    void (async () => {
      let draft = DEFAULT_PHOTO_REQUEST_DRAFT;
      try {
        const raw = sessionStorage.getItem(PROFILE_PHOTO_REQUEST_NAV_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as ProfilePhotoRequestNavPayload;
          if (parsed.profileId === pid && typeof parsed.draft === 'string' && parsed.draft.trim()) {
            draft = parsed.draft.trim();
          }
        }
      } catch {
        /* ignore */
      }

      // Timeout guard: voorkomt dat de pagina eeuwig op "Laden..." blijft hangen als de server traag is.
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 10_000);

      try {
        const createRes = await fetch('/api/conversations', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: pid }),
          signal: controller.signal,
        });
        window.clearTimeout(timeoutId);

        const createData = (await createRes.json()) as {
          conversation?: Conversation;
          error?: string;
        };

        if (!createRes.ok) {
          setLoadingList(false);
          if (createRes.status === 401) {
            window.location.assign(`/inloggen?next=${encodeURIComponent(`/profielen/${pid}`)}`);
            return;
          }
          setError(createData.error ?? 'Chat openen mislukt');
          router.replace('/berichten', { scroll: false });
          return;
        }

        const conv = createData.conversation;
        if (!conv?.id) {
          setLoadingList(false);
          setError('Chat openen mislukt');
          router.replace('/berichten', { scroll: false });
          return;
        }

        try {
          sessionStorage.removeItem(PROFILE_PHOTO_REQUEST_NAV_KEY);
        } catch {
          /* */
        }

        conversationCacheRef.current[conv.id] = conv;

        const summary: ConversationSummary = {
          id: conv.id,
          profileId: conv.profileId,
          profileName: conv.profileName,
          previewAvatar: conv.previewAvatar,
          lastMessage: '',
          lastMessageFromAssistant: false,
          timestamp: formatMessageTime(conv.updatedAt),
          updatedAt: conv.updatedAt,
          unread: 0,
          isOnline: conv.isOnline,
        };
        setList((prev) => {
          const without = prev.filter((c) => c.profileId !== conv.profileId);
          const next = [summary, ...without];
          listRef.current = next;
          return next;
        });

        setLoadingList(false);
        setLoadingMessages(false);

        setSelectedId(conv.id);
        setInput(draft);
        focusComposerAfterProfileOpenRef.current = true;
        router.replace(`/berichten?chat=${encodeURIComponent(conv.id)}`, { scroll: false });

        // Do NOT call fetchList here — it would overwrite the optimistic conversation we just added.
        // Background refresh will pick up the new chat later.
      } catch (e) {
        window.clearTimeout(timeoutId);
        setLoadingList(false);
        if ((e as any)?.name === 'AbortError') {
          setError('Chat openen duurt te lang. Probeer het opnieuw.');
          router.replace('/berichten', { scroll: false });
        } else {
          setError(e instanceof Error ? e.message : 'Chat openen mislukt');
          router.replace('/berichten', { scroll: false });
        }
      }
    })();
  }, [profileOpenParam, router]);

  useEffect(() => {
    if (selectedId) {
      const cached = conversationCacheRef.current[selectedId];
      if (cached) {
        setConversation(cached);
        setLoadingMessages(false);
        loadingConversationIdRef.current = null;
        void fetchConversation(selectedId, { soft: true });
      } else {
        setConversation(null);
        fetchConversation(selectedId);
      }
    } else {
      setConversation(null);
      setLoadingMessages(false);
      loadingConversationIdRef.current = null;
    }
  }, [selectedId, fetchConversation]);

  useEffect(() => {
    if (!selectedId) return;
    const id = window.setInterval(() => {
      void fetchConversation(selectedId, { soft: true });
      void fetchList({ silent: true });
    }, 5000);
    return () => window.clearInterval(id);
  }, [selectedId, fetchConversation, fetchList]);

  const conversationForUi =
    selectedId && conversation?.id === selectedId
      ? conversation
      : selectedId
        ? (conversationCacheRef.current[selectedId] ?? null)
        : null;

  useEffect(() => {
    if (conversationForUi?.profileName) {
      conversationProfileNameRef.current = conversationForUi.profileName;
    }
  }, [conversationForUi?.profileName]);

  const displayMessages = useMemo(() => {
    if (!conversationForUi) return [];
    const merged = [
      ...conversationForUi.messages,
      ...(optimisticConversationId === selectedId ? optimisticBatch : []),
    ];
    const deduped = deduplicateMessages(merged);
    return sortChatMessagesChronologically(deduped);
  }, [
    conversationForUi,
    optimisticConversationId,
    selectedId,
    optimisticBatch,
  ]);

  const activeConversation =
    conversationForUi;

  useLayoutEffect(() => {
    if (!focusComposerAfterProfileOpenRef.current) return;
    if (!activeConversation || loadingMessages) return;
    focusComposerAfterProfileOpenRef.current = false;
    requestAnimationFrame(() => {
      try {
        composerTextareaRef.current?.focus({ preventScroll: true });
      } catch {
        composerTextareaRef.current?.focus();
      }
    });
  }, [activeConversation?.id, loadingMessages]);

  const lastChronologicalMsgId =
    displayMessages.length > 0 ? displayMessages[displayMessages.length - 1]!.id : '';

  const scrollChatToBottom = useCallback((force = true) => {
    const el = chatScrollRef.current;
    if (!el) return;
    const run = () => {
      const threshold = 120;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (force || dist < threshold) {
        el.scrollTop = el.scrollHeight;
      }
    };
    run();
    requestAnimationFrame(run);
    window.setTimeout(run, 50);
    window.setTimeout(run, 200);
  }, []);

  useLayoutEffect(() => {
    if (!selectedId || loadingMessages) return;
    scrollChatToBottom(true);
  }, [
    selectedId,
    loadingMessages,
    displayMessages.length,
    lastChronologicalMsgId,
    inflightSends.size,
    scrollChatToBottom,
  ]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el || !selectedId) return;
    const ro = new ResizeObserver(() => {
      const threshold = 120;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (dist < threshold) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [selectedId, conversation?.id]);

  useEffect(() => {
    optimisticConversationIdRef.current = optimisticConversationId;
  }, [optimisticConversationId]);

  useEffect(() => {
    outgoingAccumRef.current = [];
    if (batchFlushTimerRef.current) {
      clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = null;
    }
    outgoingConversationIdRef.current = null;
    if (
      optimisticConversationId != null &&
      inflightSends.has(optimisticConversationId)
    ) {
      return;
    }
    setOptimisticBatch([]);
    setOptimisticImageById({});
    setOptimisticConversationId(null);
    setShowGiftPanel(false);
  }, [selectedId, optimisticConversationId, inflightSends]);

  useEffect(() => {
    listRef.current = list;
  }, [list]);

  useEffect(() => {
    setAttachMenuOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (attachMenuRef.current?.contains(e.target as Node)) return;
      setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [attachMenuOpen]);

  useEffect(() => {
    if (conversationForUi?.id) {
      messagesLenByConvRef.current[conversationForUi.id] = conversationForUi.messages.length;
    }
  }, [conversationForUi?.id, conversationForUi?.messages.length]);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (recordingStreamRef.current) {
        for (const t of recordingStreamRef.current.getTracks()) t.stop();
      }
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {}
      }
      for (const url of Object.values(localVoiceUrlByIdRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!isRecordingVoice) return;
    const id = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRecordingVoice]);

  useEffect(() => {
    localVoiceUrlByIdRef.current = localVoiceUrlById;
  }, [localVoiceUrlById]);

  const stopVoicePlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setPlayingVoiceId(null);
  }, []);

  const toggleVoiceMessage = useCallback(
    async (m: ChatMessage) => {
      if (!m.voice || !selectedId) return;
      if (playingVoiceId === m.id) {
        stopVoicePlayback();
        return;
      }
      stopVoicePlayback();
      setPlayingVoiceId(m.id);
      try {
        let url = localVoiceUrlByIdRef.current[m.id];
        if (!url) {
          const res = await fetch(`/api/conversations/${selectedId}/voice/${m.id}`, {
            credentials: 'include',
          });
          if (!res.ok) throw new Error('Voice niet gevonden');
          const blob = await res.blob();
          url = URL.createObjectURL(blob);
        }
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => stopVoicePlayback();
        await audio.play();
      } catch {
        stopVoicePlayback();
      }
    },
    [playingVoiceId, selectedId, stopVoicePlayback]
  );

  const sendRecordedVoice = useCallback(
    async (blob: Blob) => {
      const sid = selectedIdRef.current;
      if (!sid) return;
      const localVoiceId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      const localVoiceUrl = URL.createObjectURL(blob);
      const durationMs = await new Promise<number | undefined>((resolve) => {
        const el = document.createElement('audio');
        el.preload = 'metadata';
        el.src = localVoiceUrl;
        const done = (value?: number) => {
          el.removeAttribute('src');
          el.load();
          resolve(value);
        };
        el.onloadedmetadata = () => {
          if (Number.isFinite(el.duration) && el.duration > 0) {
            done(Math.round(el.duration * 1000));
            return;
          }
          done(undefined);
        };
        el.onerror = () => done(undefined);
      });
      setLocalVoiceUrlById((prev) => ({ ...prev, [localVoiceId]: localVoiceUrl }));
      const localVoiceMessage: ChatMessage = {
        id: localVoiceId,
        role: 'user',
        content: '🎤 Spraakbericht',
        createdAt: nowIso,
        readByPeer: false,
        voice: {
          language: 'nl',
          transcript: voiceDraftTranscript.trim() || undefined,
          mimeType: blob.type || 'audio/webm',
          durationMs,
        },
      };
      setConversation((c) => {
        if (!c || c.id !== sid) return c;
        return {
          ...c,
          messages: sortChatMessagesChronologically([...c.messages, localVoiceMessage]),
          updatedAt: nowIso,
        };
      });
      setIsTranscribingVoice(true);
      setError(null);
      void (async () => {
        try {
        const form = new FormData();
        form.append("audio", blob, "voice.webm");
        form.append("language", "nl");
        form.append("clientMessageId", localVoiceId);
        if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
          form.append("durationMs", String(Math.floor(durationMs)));
        }
        if (voiceDraftTranscript.trim()) {
          form.append("fallbackText", voiceDraftTranscript.trim());
        }
        const res = await fetch(`/api/conversations/${sid}/messages/voice`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        const data = (await res.json()) as {
          error?: string;
          userMessages?: ChatMessage[];
          assistantMessage?: ChatMessage | null;
          transcript?: string;
        };
        if (!res.ok) throw new Error(data.error || "Spraak versturen mislukt");

        const u = data.userMessages ?? [];
        const a = data.assistantMessage;
        const serverSlice = [...u, ...(a ? [a] : [])];
        if (serverSlice.length > 0) {
          setLocalVoiceUrlById((prev) => {
            const current = prev[localVoiceId];
            if (current) URL.revokeObjectURL(current);
            const { [localVoiceId]: _omit, ...rest } = prev;
            return rest;
          });
          setConversation((c) => {
            if (!c || c.id !== sid) return c;
            const withoutOptimistic = c.messages.filter((m) => m.id !== localVoiceId);
            const merged = sortChatMessagesChronologically(
              deduplicateMessages([...withoutOptimistic, ...serverSlice])
            );
            const tail = merged[merged.length - 1];
            return {
              ...c,
              messages: merged,
              updatedAt: tail?.createdAt ?? c.updatedAt,
            };
          });
        }

        await fetchConversation(sid, { soft: true });
        await fetchList({ silent: true });
        } catch (e) {
          setError(e instanceof Error ? e.message : "Spraak versturen mislukt");
        } finally {
          setIsTranscribingVoice(false);
        }
      })();
    },
    [fetchConversation, fetchList, voiceDraftTranscript]
  );

  const sendVoiceDraft = useCallback(() => {
    if (!voiceDraftBlob || isTranscribingVoice) return;
    void sendRecordedVoice(voiceDraftBlob);
    setVoiceDraftBlob(null);
    setVoiceDraftTranscript('');
    setRecordingSeconds(0);
  }, [voiceDraftBlob, isTranscribingVoice, sendRecordedVoice]);

  const cancelVoiceDraft = useCallback(() => {
    setVoiceDraftBlob(null);
    setVoiceDraftTranscript('');
    setRecordingSeconds(0);
  }, []);

  const toggleVoiceRecording = useCallback(async () => {
    if (isTranscribingVoice) return;
    const sid = selectedIdRef.current;
    if (!sid) return;

    if (isRecordingVoice) {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordingChunksRef.current = [];
      setVoiceDraftBlob(null);
      setVoiceDraftTranscript('');
      setRecordingSeconds(0);
      speechTranscriptRef.current = '';
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      const w = window as any;
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (SR) {
        const sr = new SR();
        sr.lang = 'nl-NL';
        sr.continuous = true;
        sr.interimResults = true;
        sr.onresult = (event: any) => {
          let merged = '';
          for (let i = 0; i < event.results.length; i += 1) {
            merged += event.results[i][0]?.transcript ?? '';
          }
          speechTranscriptRef.current = merged.trim();
          setVoiceDraftTranscript(speechTranscriptRef.current);
        };
        try {
          sr.start();
          speechRecognitionRef.current = sr;
        } catch {
          speechRecognitionRef.current = null;
        }
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("Opname mislukt.");
      };
      recorder.onstop = () => {
        setIsRecordingVoice(false);
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recordingChunksRef.current = [];
        if (speechRecognitionRef.current) {
          try {
            speechRecognitionRef.current.stop();
          } catch {}
          speechRecognitionRef.current = null;
        }
        if (recordingStreamRef.current) {
          for (const t of recordingStreamRef.current.getTracks()) t.stop();
        }
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        if (blob.size > 0) {
          setVoiceDraftBlob(blob);
          setVoiceDraftTranscript(speechTranscriptRef.current.trim());
        }
      };

      recorder.start();
      setAttachMenuOpen(false);
      setIsRecordingVoice(true);
    } catch {
      setError("Microfoon-toegang geweigerd of niet beschikbaar.");
      setIsRecordingVoice(false);
    }
  }, [isRecordingVoice, isTranscribingVoice]);

  // Deduplicate by profileId — meest recente thread (updatedAt), niet op "HH:mm" string
  const dedupedList = useMemo(() => {
    const byProfile = new Map<string, ConversationSummary>();
    for (const chat of list) {
      const existing = byProfile.get(chat.profileId);
      const t = summaryActivityMs(chat);
      const exT = existing ? summaryActivityMs(existing) : -1;
      if (!existing || t > exT) {
        byProfile.set(chat.profileId, chat);
      }
    }
    return Array.from(byProfile.values());
  }, [list]);

  /** Zelfde profiel, verkeerde conversation-id (oude duplicate) → spring naar canonieke thread */
  useEffect(() => {
    if (!selectedId || list.length === 0 || loadingList) return;
    const row = list.find((c) => c.id === selectedId);
    if (!row) {
      // Transient (e.g. just-created deep link not yet in a concurrent list fetch). Refresh instead of nuking selection.
      void fetchList({ silent: true });
      return;
    }
    const same = list.filter((c) => c.profileId === row.profileId);
    if (same.length < 2) return;
    const best = [...same].sort((a, b) => summaryActivityMs(b) - summaryActivityMs(a))[0]!;
    if (best.id !== selectedId) {
      setSelectedId(best.id);
      router.replace(`/berichten?chat=${encodeURIComponent(best.id)}`, { scroll: false });
    }
  }, [list, selectedId, router, loadingList]);

  const filteredList = dedupedList.filter((c) => {
    const q = query.toLowerCase();
    return (
      (c.profileName ?? '').toLowerCase().includes(q) ||
      (c.lastMessage ?? '').toLowerCase().includes(q)
    );
  });

  const totalUnread = dedupedList.reduce((a, c) => a + (c.unread || 0), 0);

  const lastAssistantIso = conversationForUi
    ? lastAssistantMessageAt(conversationForUi.messages)
    : null;
  const assistantMsgCount = conversationForUi
    ? conversationForUi.messages.filter((m) => m.role === 'assistant').length
    : 0;
  const lastOnlineSubtitle =
    conversationForUi && assistantMsgCount === 0
      ? `${syntheticLastSeenMinutes(conversationForUi.id)} minuten geleden`
      : lastAssistantIso
        ? formatLastOnlineAgo(lastAssistantIso, presenceNow)
        : '—';
  const sendingHere = Boolean(selectedId && inflightSends.has(selectedId));
  const sendStartedAtHere = selectedId ? sendStartedAtByConv[selectedId] ?? uiNow : uiNow;
  const typingVisibleAtHere = selectedId ? typingVisibleAtByConv[selectedId] ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
  const pendingIndicatorVisible = sendingHere && uiNow >= typingVisibleAtHere && typingVisibleAtHere !== Number.MAX_SAFE_INTEGER;
  const onlineWaitOffset =
    selectedId?.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) ?? 0;
  const waitingOnlineCycleMs = 45_000;
  const waitingOnlineOnMs = 28_000;
  const waitingElapsed = Math.max(0, uiNow - sendStartedAtHere);
  const waitingPhaseOnline =
    ((waitingElapsed + onlineWaitOffset) % waitingOnlineCycleMs) < waitingOnlineOnMs;
  const optimisticHere = Boolean(
    optimisticConversationId === selectedId && optimisticBatch.length > 0
  );
  const isPeerOnlineNow =
    (sendingHere ? waitingPhaseOnline : false) ||
    optimisticHere ||
    (peerOnlineUntil !== null && Date.now() < peerOnlineUntil);

  const triggerNoCreditsFlow = useCallback((_convId: string) => {
    openPricing();
  }, [openPricing]);

  const clearBatchTimer = useCallback(() => {
    if (batchFlushTimerRef.current) {
      clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = null;
    }
  }, []);

  const clearOptimisticForConversation = useCallback((convId: string) => {
    if (optimisticConversationIdRef.current !== convId) return;
    optimisticConversationIdRef.current = null;
    setOptimisticConversationId(null);
    setOptimisticBatch([]);
    setOptimisticImageById({});
  }, []);

  const flushOutgoingBatch = useCallback(async (
    sidOverride?: string,
    batchOverride?: Array<{
      text: string;
      image?: { base64: string; mime: string; previewUrl: string };
      replyToId?: string;
    }>,
    sendOpts?: { noCredits?: boolean }
  ): Promise<boolean> => {
    clearBatchTimer();
    const batch = batchOverride ?? outgoingAccumRef.current;
    if (batch.length === 0) return false;
    const sid = sidOverride ?? outgoingConversationIdRef.current ?? selectedIdRef.current;
    if (!sid) return false;
    if (sendGuardByConvRef.current.has(sid)) return false;
    sendGuardByConvRef.current.add(sid);

    try {
      const noCredits = sendOpts?.noCredits === true;
      const convForCost =
        conversationCacheRef.current[sid] ??
        (conversationForUi?.id === sid ? conversationForUi : null);
      const userMsgCountBefore =
        convForCost?.messages.filter((m) => m.role === 'user').length ?? 0;
      const cost = noCredits
        ? 0
        : CREDITS_PER_MESSAGE <= 0
          ? 0
          : userMsgCountBefore === 0
            ? 0
            : creditsCostForBatchSize(batch.length);
      const balance = getCreditsBalance();
      if (!noCredits && CREDITS_PER_MESSAGE > 0 && balance < cost) {
        void fetch(`/api/conversations/${sid}/credit-runout`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => {
          /* best effort: plan cadeau alleen als gesprek al twee kanten had */
        });
        if (!batchOverride) {
          outgoingAccumRef.current = [];
          outgoingConversationIdRef.current = null;
        }
        clearOptimisticForConversation(sid);
        triggerNoCreditsFlow(sid);
        return false;
      }

      if (!batchOverride) {
        outgoingAccumRef.current = [];
      }

      setInflightSends((prev) => new Set(prev).add(sid));
      setSendStartedAtByConv((prev) => ({ ...prev, [sid]: Date.now() }));
      setTypingVisibleAtByConv((prev) => ({
        ...prev,
        [sid]: Date.now() + typingIndicatorDelayMs(messagesLenByConvRef.current[sid] ?? 0),
      }));
      setError(null);

      const items = batch.map((b) => ({
        text: b.text,
        imageBase64: b.image?.base64,
        imageMime: b.image?.mime,
        replyToId: b.replyToId,
      }));

      const anyImg = items.some((i) => i.imageBase64);

      /** Direct aftrekken bij verzenden; API kan minuten duren (typ-pauze + AI). */
      const prepaid = !noCredits && cost > 0;
      if (prepaid) {
        spendChatCredit(cost);
        setCreditsBalance(getCreditsBalance());
        if (getCreditsBalance() < CREDITS_PER_MESSAGE) {
          void fetch(`/api/conversations/${sid}/credit-runout`, {
            method: 'POST',
            credentials: 'include',
          }).catch(() => {});
        }
      }

      try {
        const res = await fetch(`/api/conversations/${sid}/messages`, {
          method: 'POST',
          credentials: 'include',
          keepalive: !anyImg,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            noCredits ? { items, noCredits: true } : { items }
          ),
          /** Breekt eindeloos wachten af; server maxDuration is 240s. */
          signal: AbortSignal.timeout(230_000),
        });
        const data = (await res.json()) as {
          error?: string;
          creditWall?: boolean;
          userMessages?: ChatMessage[];
          assistantMessage?: ChatMessage | null;
        };
        if (!res.ok) throw new Error(data.error || 'Versturen mislukt');
      const profileMeta =
        listRef.current.find((c) => c.id === sid) ??
        (conversationForUi && conversationForUi.id === sid
          ? {
              id: sid,
              profileName: conversationForUi.profileName,
              previewAvatar: conversationForUi.previewAvatar,
            }
          : null);
      if (profileMeta) {
        pushLiveNotification(profileMeta.profileName, profileMeta.previewAvatar, `${profileMeta.profileName} typt…`);
      }
        if (data.creditWall && CREDITS_PER_MESSAGE > 0) {
          if (prepaid) refundChatCredit(cost);
          triggerNoCreditsFlow(sid);
        }
        /** Meteen serverberichten tonen vóór optimistic wordt gewist (geen “gat” in de UI). */
        const u = data.userMessages ?? [];
        const a = data.assistantMessage;
        if (u.length > 0 || a) {
          setConversation((c) => {
            if (!c || c.id !== sid) return c;
            const add = [...u, ...(a ? [a] : [])];
            const existingIds = new Set(c.messages.map((m) => m.id));
            const newOnly = add.filter((m) => !existingIds.has(m.id));
            if (newOnly.length === 0) return c;
            return {
              ...c,
              messages: sortChatMessagesChronologically([...c.messages, ...newOnly]),
              updatedAt: newOnly[newOnly.length - 1]?.createdAt ?? c.updatedAt,
            };
          });
        }
      if (a && profileMeta) {
        pushLiveNotification(
          profileMeta.profileName,
          profileMeta.previewAvatar,
          `${profileMeta.profileName} leest je bericht`
        );
      }
        // Alleen wissen als server de user-berichten al heeft teruggegeven.
        // Anders laat optimistic staan zodat verzonden tekst niet "verdwijnt".
        if ((data.userMessages?.length ?? 0) > 0 || data.creditWall) {
          clearOptimisticForConversation(sid);
        }
        if (!batchOverride) {
          outgoingConversationIdRef.current = null;
        }
        await fetchConversation(sid, { soft: true });
        await fetchList({ silent: true });

        if (!data.creditWall) {
          const pname =
            listRef.current.find((c) => c.id === sid)?.profileName ??
            conversationProfileNameRef.current;
          const activeSameChat = selectedIdRef.current === sid;
          if (!activeSameChat) {
            setArrivalToast(`${pname} heeft je een berichtje gestuurd`);
            if (arrivalToastTimerRef.current) {
              window.clearTimeout(arrivalToastTimerRef.current);
            }
            arrivalToastTimerRef.current = window.setTimeout(() => {
              arrivalToastTimerRef.current = null;
              setArrivalToast(null);
            }, 4800);
          }
          const assistantText = (data.assistantMessage?.content ?? '').toLowerCase();
          const goesTemporarilyOffline =
            /kom zo terug|zo terug|ik ga .*camera|ik pak .*camera|heel even weg|ben zo terug/.test(
              assistantText
            );
          if (goesTemporarilyOffline) {
            // Als ze zegt dat ze zo terugkomt, toon haar even offline.
            setPeerOnlineUntil(null);
          } else {
            setPeerOnlineUntil((prev) => {
              const extra = 40_000 + Math.floor(Math.random() * 110_000);
              const until = Date.now() + extra;
              return Math.max(prev ?? 0, until);
            });
          }
        }

        return true;
      } catch (e) {
        if (prepaid) refundChatCredit(cost);
        // Server kan user-berichten al hebben opgeslagen terwijl het antwoord traag/time-out is.
        // Houd optimistic bubble zichtbaar zodat het bericht niet "verdwijnt" in de UI.
        await fetchConversation(sid, { soft: true });
        await fetchList({ silent: true });
        if (!batchOverride) {
          outgoingConversationIdRef.current = null;
        }
        setError(e instanceof Error ? e.message : 'Fout bij versturen');
        return false;
      } finally {
        setInflightSends((prev) => {
          const next = new Set(prev);
          next.delete(sid);
          return next;
        });
        setTypingVisibleAtByConv((prev) => {
          const { [sid]: _, ...rest } = prev;
          return rest;
        });
        setSendStartedAtByConv((prev) => {
          const { [sid]: _, ...rest } = prev;
          return rest;
        });
        if (!batchOverride) {
          outgoingConversationIdRef.current = null;
        }
      }
    } finally {
      sendGuardByConvRef.current.delete(sid);
      // Als er tijdens een lopende request alweer nieuwe user-berichten zijn
      // getypt/verzonden, flush ze direct erna als volgende batch.
      if (
        outgoingConversationIdRef.current === sid &&
        outgoingAccumRef.current.length > 0 &&
        !sendGuardByConvRef.current.has(sid)
      ) {
        window.setTimeout(() => {
          void flushOutgoingBatch(sid);
        }, 0);
      }
    }
  }, [
    clearBatchTimer,
    clearOptimisticForConversation,
    conversationForUi,
    fetchConversation,
    fetchList,
    triggerNoCreditsFlow,
  ]);

  /** Eerste bericht van profielpagina: chat opent meteen; POST gebeurt hier (niet blokkeren op AI). */
  useEffect(() => {
    if (!chatParam || typeof window === 'undefined') return;

    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(PROFILE_PENDING_SEND_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    let pending: ProfilePendingSend;
    try {
      pending = JSON.parse(raw) as ProfilePendingSend;
    } catch {
      try {
        sessionStorage.removeItem(PROFILE_PENDING_SEND_KEY);
      } catch {
        /* */
      }
      return;
    }

    if (pending.conversationId !== chatParam) return;

    try {
      if (sessionStorage.getItem(PROFILE_PENDING_LOCK_KEY) === chatParam) return;
      sessionStorage.setItem(PROFILE_PENDING_LOCK_KEY, chatParam);
    } catch {
      return;
    }

    void (async () => {
      try {
        const ok = await flushOutgoingBatch(
          pending.conversationId,
          [{ text: pending.text }],
          { noCredits: pending.noCredits === true }
        );
        if (ok) {
          try {
            sessionStorage.removeItem(PROFILE_PENDING_SEND_KEY);
          } catch {
            /* */
          }
        }
      } finally {
        try {
          const l = sessionStorage.getItem(PROFILE_PENDING_LOCK_KEY);
          if (l === chatParam) sessionStorage.removeItem(PROFILE_PENDING_LOCK_KEY);
        } catch {
          /* */
        }
      }
    })();
  }, [chatParam, flushOutgoingBatch]);

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png)$/i.test(file.type)) {
      setError('Alleen JPG- of PNG-foto’s.');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setError('Foto max. 6MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] ?? '';
      if (!base64) return;
      setPendingImage({
        base64,
        mime: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        previewUrl: dataUrl,
      });
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSend = () => {
    if (!selectedId) return;
    const trimmed = input.trim();
    if (!trimmed && !pendingImage) return;

    // Voorkom double fire (bijv. touch/click + enter race): dezelfde payload
    // binnen korte tijd maar één keer in optimistic queue.
    const sendFingerprint = [
      selectedId,
      trimmed,
      pendingImage ? pendingImage.base64.slice(0, 32) : '',
      replyToId ?? '',
    ].join('|');
    const nowMs = Date.now();
    if (
      lastSendFingerprintRef.current &&
      lastSendFingerprintRef.current.key === sendFingerprint &&
      nowMs - lastSendFingerprintRef.current.at < 1500
    ) {
      return;
    }
    lastSendFingerprintRef.current = { key: sendFingerprint, at: nowMs };

    if (trimmed.length > MAX_USER_MESSAGE_CHARS) {
      setError(
        `Je bericht is langer dan ${MAX_USER_MESSAGE_CHARS} tekens. Maak het korter of stuur het in meerdere berichten.`
      );
      return;
    }
    const priorUserMsgCount =
      activeConversation?.messages.filter((m) => m.role === 'user').length ?? 0;
    const sendCost =
      CREDITS_PER_MESSAGE <= 0
        ? 0
        : priorUserMsgCount === 0
          ? 0
          : creditsCostForBatchSize(1);
    if (CREDITS_PER_MESSAGE > 0 && getCreditsBalance() < sendCost) {
      triggerNoCreditsFlow(selectedId);
      return;
    }

    setError(null);
    const sentImage = pendingImage;
    setInput('');
    setPendingImage(null);

    outgoingConversationIdRef.current = selectedId;

    const createdAtIso = new Date().toISOString();
    const om: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: 'user',
      content: trimmed || '📷',
      createdAt: createdAtIso,
      readByPeer: false,
      replyToId: replyToId ?? undefined,
    };
    applyOptimisticListPreview(selectedId, trimmed || '📷', createdAtIso);
    optimisticConversationIdRef.current = selectedId;
    setOptimisticConversationId(selectedId);
    setOptimisticBatch((prev) => [...prev, om]);
    if (sentImage) {
      setOptimisticImageById((prev) => ({ ...prev, [om.id]: sentImage.previewUrl }));
    }

    if (onlineDelayTimerRef.current) {
      window.clearTimeout(onlineDelayTimerRef.current);
      onlineDelayTimerRef.current = null;
    }
    const delayedOnline = Math.random() < 0.28;
    const bumpPeerOnline = () =>
      setPeerOnlineUntil((prev) => Math.max(prev ?? 0, Date.now() + 12 * 60 * 1000));
    if (delayedOnline) {
      const ms = 60_000 + Math.floor(Math.random() * 150_000);
      onlineDelayTimerRef.current = window.setTimeout(() => {
        onlineDelayTimerRef.current = null;
        bumpPeerOnline();
      }, ms);
    } else {
      bumpPeerOnline();
    }

    outgoingAccumRef.current.push({
      text: trimmed,
      image: sentImage ?? undefined,
      replyToId: replyToId ?? undefined,
    });
    if (!inflightSends.has(selectedId) && !sendGuardByConvRef.current.has(selectedId)) {
      clearBatchTimer();
      // Direct starten: voorkomt dat berichten blijven hangen als timer niet vuurt.
      void flushOutgoingBatch(selectedId);
    }
    setReplyToId(null);
  };

  const handleSendGift = async (giftCredits: number, packageLabel: string) => {
    if (!selectedId || inflightSends.has(selectedId) || sendGuardByConvRef.current.has(selectedId)) return;
    if (getCreditsBalance() < giftCredits) {
      void fetch(`/api/conversations/${selectedId}/credit-runout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
      triggerNoCreditsFlow(selectedId);
      return;
    }
    const cleanNote = giftNote.trim();
    applyOptimisticListPreview(
      selectedId,
      cleanNote || `🎁 ${giftCredits} credits gestuurd`,
      new Date().toISOString()
    );
    setSendStartedAtByConv((prev) => ({ ...prev, [selectedId]: Date.now() }));
    setTypingVisibleAtByConv((prev) => ({
      ...prev,
      [selectedId]:
        Date.now() +
        typingIndicatorDelayMs(messagesLenByConvRef.current[selectedId] ?? 0),
    }));
    setInflightSends((prev) => new Set(prev).add(selectedId));
    setError(null);
    const nowIso = new Date().toISOString();
    const optimisticGiftMessage: ChatMessage = {
      id: `tmp-gift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: cleanNote || `cadeautje voor ${activeConversation?.profileName ?? 'jou'}`,
      createdAt: nowIso,
      readByPeer: false,
      gift: {
        credits: giftCredits,
        direction: 'to_peer',
        emoji: '🎉',
        packageLabel: packageLabel.trim() || `${giftCredits} credits`,
        note: cleanNote || undefined,
      },
    };
    optimisticConversationIdRef.current = selectedId;
    setOptimisticConversationId(selectedId);
    setOptimisticBatch((prev) => [...prev, optimisticGiftMessage]);
    spendChatCredit(giftCredits);
    setCreditsBalance(getCreditsBalance());
    if (getCreditsBalance() < CREDITS_PER_MESSAGE) {
      void fetch(`/api/conversations/${selectedId}/credit-runout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
    }
    try {
      const res = await fetch(`/api/conversations/${selectedId}/gift`, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credits: giftCredits,
          packageLabel,
          note: cleanNote || `cadeautje voor ${activeConversation?.profileName ?? 'jou'}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gift sturen mislukt');
      setShowGiftPanel(false);
      try {
        await fetchConversation(selectedId, { soft: true });
        await fetchList({ silent: true });
      } catch {
        /* Cadeau staat al op de server; geen terugbetaling. */
      }
    } catch (e) {
      refundChatCredit(giftCredits);
      setCreditsBalance(getCreditsBalance());
      setError(e instanceof Error ? e.message : 'Gift sturen mislukt');
    } finally {
      // Clear loading state immediately on gift (user message persisted on server)
      setInflightSends((prev) => {
        const next = new Set(prev);
        next.delete(selectedId);
        return next;
      });
      setTypingVisibleAtByConv((prev) => {
        const { [selectedId]: _, ...rest } = prev;
        return rest;
      });
      setSendStartedAtByConv((prev) => {
        const { [selectedId]: _, ...rest } = prev;
        return rest;
      });
      sendGuardByConvRef.current.delete(selectedId);
    }
  };

  const selectChat = (id: string) => {
    setSelectedId(id);
    router.push(`/berichten?chat=${id}`);
  };

  const backToList = () => {
    setSelectedId(null);
    setConversation(null);
    router.push('/berichten', { scroll: false });
  };

  const openActiveProfile = () => {
    const profileId = activeConversation?.profileId?.trim();
    if (!profileId) return;
    router.push(`/profielen/${profileId}`);
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-[var(--surface)]">
      <Navbar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-12 sm:pt-14 lg:pt-20">
        <div className="mx-auto flex min-h-0 w-full max-w-screen-xl flex-1 flex-col overflow-hidden px-2 sm:px-4 lg:flex-row lg:items-stretch lg:px-6">
        {/* Inbox list - fully responsive, full height on mobile */}
        <div
          className={`flex w-full flex-shrink-0 flex-col border-b border-gray-200/80 bg-[var(--surface-card)] lg:min-h-0 lg:max-h-none lg:basis-[32%] lg:max-w-sm lg:border-b-0 lg:border-r lg:overflow-hidden ${
            selectedId || openingProfileDeepLink
              ? 'hidden lg:flex'
              : 'flex flex-1 min-h-0 lg:flex-none lg:h-auto'
          }`}
        >
          <div className="p-4 md:p-6 border-b border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-2xl text-gray-900">Berichten</h2>
              <div className="flex items-center gap-2">
                <div className="bg-primary text-white text-xs font-semibold px-2.5 py-1 rounded-full min-w-[28px] text-center">
                  {list.length > 0 ? totalUnread || list.length : totalUnread}
                </div>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-4 top-3.5 text-gray-400 w-4 h-4" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zoek in berichten..."
                className="w-full rounded-2xl border-0 bg-gray-100 py-3 pl-11 pr-4 text-base focus:ring-2 focus:ring-primary/30 md:text-sm"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {filteredList.length === 0 ? (
              <p className="p-6 text-gray-500 text-sm">Nog geen berichten</p>
            ) : (
              filteredList.map((chat) => (
                <button
                  key={chat.profileId} // Use profileId as stable key (1 cell per profile)
                  type="button"
                  onClick={() => selectChat(chat.id)}
                  className={`w-full flex gap-3 px-4 md:px-6 py-4 text-left border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    selectedId === chat.id ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <img
                      src={profilePhotoSrc(chat.previewAvatar || '', { widthCss: 48, heightCss: 48 })}
                      alt=""
                      className="w-12 h-12 rounded-2xl object-cover ring-2 ring-white shadow-sm"
                    />
                    {chat.isOnline && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-primary border-2 border-white rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-semibold text-[15px] text-gray-900">
                        {chat.profileName}
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {chat.timestamp}
                      </span>
                    </div>
                    <p
                      className={`line-clamp-2 mt-0.5 text-sm ${
                        chat.lastMessageFromAssistant
                          ? 'font-bold text-gray-900'
                          : 'font-normal text-gray-600'
                      }`}
                    >
                      {chat.lastMessage}
                    </p>
                  </div>
                  {chat.unread > 0 && (
                    <span className="self-center shrink-0 bg-primary text-white text-[10px] font-bold min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full">
                      {chat.unread}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat / empty - full height when open on mobile */}
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-card)] ${
            selectedId || openingProfileDeepLink ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {visibleError && (
            <div className="mx-4 mt-4 shrink-0 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {visibleError}
            </div>
          )}

          {(selectedId || openingProfileDeepLink) &&
            (loadingMessages || profileDeepLinkBooting) && (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              Laden…
            </div>
          )}

          {selectedId && !loadingMessages && activeConversation && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {arrivalToast && (
                <div
                  role="status"
                  className="mx-4 mt-3 shrink-0 rounded-2xl bg-gray-900 px-4 py-3 text-center text-[13px] font-medium leading-snug text-white shadow-lg"
                >
                  {arrivalToast}
                </div>
              )}

              <div className="flex shrink-0 items-center gap-3 border-b border-gray-200/70 bg-[var(--surface-card)] px-4 py-3">
                <button
                  type="button"
                  onClick={backToList}
                  className="shrink-0 text-primary font-medium text-sm lg:hidden"
                >
                  ← Terug
                </button>
                <button
                  type="button"
                  onClick={openActiveProfile}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1.5 py-1 text-left transition-colors hover:bg-gray-50"
                  aria-label={`Open profiel van ${activeConversation.profileName}`}
                >
                  <div className="relative shrink-0">
                    <img
                      src={profilePhotoSrc(activeConversation.previewAvatar || '', { widthCss: 56, heightCss: 56 })}
                      alt=""
                      className="h-14 w-14 rounded-2xl object-cover ring-2 ring-white shadow-sm"
                    />
                    {isPeerOnlineNow && (
                      <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-bold text-[20px] leading-tight text-gray-900">
                      {activeConversation.profileName}
                    </h2>
                    <p className="mt-0.5 truncate text-[14px] text-gray-500">
                      {isPeerOnlineNow ? (
                        <span className="font-semibold text-primary">Online</span>
                      ) : (
                        <>
                          Voor het laatst online ·{' '}
                          <span className="text-gray-600">{lastOnlineSubtitle}</span>
                        </>
                      )}
                    </p>
                  </div>
                </button>
              </div>

              <div
                ref={chatScrollRef}
                className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-3 [-webkit-overflow-scrolling:touch] md:px-4"
              >
                <div className="flex min-h-full flex-col gap-3 py-3 md:gap-4 md:py-4">
                {(displayMessages.length > 0 || pendingIndicatorVisible) && <div className="mt-auto" />}
                {displayMessages.length === 0 && null}
                {displayMessages.map((m: ChatMessage) => (
                    <div
                      key={m.id}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      onPointerDown={(e) => handleReplySwipeStart(m.id, e)}
                      onPointerMove={(e) => handleReplySwipeMove(m.id, e)}
                      onPointerUp={() => handleReplySwipeEnd(m.id)}
                      onPointerCancel={() => handleReplySwipeEnd(m.id)}
                    >
                      <div
                        className="transition-transform duration-150"
                        style={{ transform: `translateX(${swipeOffsetByMessageId[m.id] ?? 0}px)` }}
                      >
                      {m.voice ? (
                        <div className={`flex max-w-[88%] flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} space-y-2`}>
                          {m.voice.ttsText && (
                            <div className="rounded-2xl px-4 py-3 text-[15px] leading-snug bg-[var(--surface-card)] text-gray-900 border border-gray-200/60 shadow-md shadow-black/10">
                              <p className="whitespace-pre-wrap">{m.content}</p>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => void toggleVoiceMessage(m)}
                            className="flex w-full min-w-[220px] max-w-[260px] items-center gap-2 rounded-[22px] border border-gray-200/80 bg-white px-3 py-2 text-left shadow-md shadow-gray-400/10 active:scale-[0.99] transition-transform"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                              {playingVoiceId === m.id ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4 pl-0.5" />
                              )}
                            </span>
                            <span className="flex flex-1 items-end justify-center gap-0.5 px-1 h-7">
                              {[3, 5, 4, 6, 3, 5, 4].map((h, i) => (
                                <span
                                  key={i}
                                  className="w-[3px] rounded-full bg-primary/40"
                                  style={{ height: `${(playingVoiceId === m.id ? h + 2 : h) * 2}px` }}
                                />
                              ))}
                            </span>
                            <Mic className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                            {!m.voice?.ttsText ? (
                              <span className="shrink-0 text-[11px] font-semibold text-gray-500">
                                {formatVoiceDuration(m.voice?.durationMs)}
                              </span>
                            ) : null}
                          </button>
                          <MessageTimestamp
                            iso={m.createdAt}
                            align={m.role === 'user' ? 'right' : 'left'}
                            variant={m.role === 'user' ? 'outgoing-meta' : 'incoming'}
                          />
                        </div>
                      ) : m.role === 'assistant' && (m.imageFile || m.photoLock) ? (
                        (() => {
                          const isUnlocked =
                            Boolean(m.photoLock?.unlockedAt) ||
                            !m.photoLock ||
                            Boolean(locallyUnlockedByMessageId[m.id]);
                          const isUnlocking = Boolean(unlockingByMessageId[m.id]);
                          const cost = m.photoLock?.credits ?? CREDITS_PER_PHOTO_UNLOCK;
                          const imgSrc = selectedId
                            ? `/api/conversations/${selectedId}/image/${m.id}`
                            : '';
                          const replied = m.replyToId
                            ? displayMessages.find((x) => x.id === m.replyToId)
                            : undefined;
                          return (
                            <div className="flex max-w-[88%] flex-col items-start space-y-2">
                              {m.content?.trim() && (
                                <div className="rounded-2xl rounded-bl-sm border border-gray-200/60 bg-[var(--surface-card)] px-4 py-3 text-[15px] leading-snug text-gray-900 shadow-md shadow-black/10">
                                  {replied ? (
                                    <div className="mb-2 rounded-xl border border-gray-200/60 bg-white px-2.5 py-2 text-[12px] leading-snug text-gray-700">
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                        reply
                                      </div>
                                      <div className="mt-1 line-clamp-2">{snippetForReply(replied)}</div>
                                    </div>
                                  ) : null}
                                  <p className="whitespace-pre-wrap">{m.content}</p>
                                </div>
                              )}
                              {isUnlocked ? (
                                <div className="aspect-[9/16] w-[240px] max-w-full overflow-hidden rounded-2xl border border-primary/25 shadow-md sm:w-[280px] md:w-[300px]">
                                  <button
                                    type="button"
                                    onClick={() => imgSrc && setLightboxSrc(imgSrc)}
                                    disabled={!imgSrc}
                                    className="block h-full w-full cursor-zoom-in border-0 bg-transparent p-0 text-left disabled:cursor-default"
                                    aria-label="Foto volledig scherm"
                                  >
                                    <img
                                      src={imgSrc}
                                      alt=""
                                      className="h-full w-full object-cover bg-black/5"
                                    />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleUnlockPhoto(m)}
                                  disabled={isUnlocking}
                                  className="group relative aspect-[9/16] w-[240px] max-w-full overflow-hidden rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-primary/15 text-left shadow-lg active:scale-[0.99] transition-all disabled:cursor-wait sm:w-[280px] md:w-[300px]"
                                  aria-label={`Foto ontgrendelen voor ${cost} credits`}
                                >
                                  {imgSrc ? (
                                    <img
                                      src={imgSrc}
                                      alt=""
                                      aria-hidden
                                      className="h-full w-full object-cover blur-2xl scale-110 select-none pointer-events-none brightness-90"
                                      draggable={false}
                                    />
                                  ) : (
                                    <div className="h-full w-full bg-gradient-to-br from-primary/30 to-primary/30" />
                                  )}
                                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 px-4 py-3 text-center">
                                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-primary shadow-md">
                                      {isUnlocking ? (
                                        <Loader2 className="h-6 w-6 animate-spin" />
                                      ) : (
                                        <Lock className="h-6 w-6" />
                                      )}
                                    </span>
                                    <p className="text-sm font-semibold text-white drop-shadow">
                                      Foto van {activeConversation?.profileName ?? 'haar'}
                                    </p>
                                    <p className="text-[12px] font-medium text-white/90 drop-shadow">
                                      {isUnlocking ? 'Laden...' : `Tik om te ontgrendelen · ${cost} credits`}
                                    </p>
                                  </div>
                                </button>
                              )}
                              <MessageTimestamp
                                iso={m.createdAt}
                                align="left"
                                variant="incoming"
                              />
                            </div>
                          );
                        })()
                      ) : m.role === 'user' ? (
                        (() => {
                          const replied = m.replyToId
                            ? displayMessages.find((x) => x.id === m.replyToId)
                            : undefined;
                          const optPreview = optimisticImageById[m.id];
                          const showImg =
                            Boolean(m.imageFile && selectedId) || Boolean(optPreview);
                          const textBody =
                            m.content && m.content !== '📷' ? m.content : '';
                          const imgSrc =
                            optPreview ??
                            `/api/conversations/${selectedId}/image/${m.id}`;
                          return (
                            <div className="flex max-w-[88%] flex-col items-end space-y-2">
                              {showImg && (
                                <div className="relative aspect-[9/16] w-[240px] max-w-full overflow-hidden rounded-2xl border border-primary/25 shadow-md sm:w-[280px] md:w-[300px]">
                                  <button
                                    type="button"
                                    onClick={() => imgSrc && setLightboxSrc(imgSrc)}
                                    disabled={!imgSrc}
                                    className="block h-full w-full cursor-zoom-in border-0 bg-transparent p-0 text-left disabled:cursor-default"
                                    aria-label="Foto volledig scherm"
                                  >
                                    <img
                                      src={imgSrc}
                                      alt=""
                                      className="h-full w-full object-cover bg-black/5"
                                    />
                                  </button>
                                  {!textBody && (
                                    <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/45 p-1.5">
                                      {m.readByPeer === false ? (
                                        <Check
                                          className="h-3.5 w-3.5 text-white"
                                          strokeWidth={2.5}
                                          aria-label="Verzonden"
                                        />
                                      ) : (
                                        <CheckCheck
                                          className="h-3.5 w-3.5 text-white/90"
                                          strokeWidth={2.5}
                                          aria-label="Gelezen"
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                              {textBody ? (
                                <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-[15px] leading-snug text-white">
                                  {replied ? (
                                    <div className="mb-2 rounded-xl bg-white/10 px-2.5 py-2 text-[12px] leading-snug">
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">
                                        reply
                                      </div>
                                      <div className="mt-1 line-clamp-2 text-white/90">
                                        {snippetForReply(replied)}
                                      </div>
                                    </div>
                                  ) : null}
                                  {m.gift ? (
                                    openedGiftByMessageId[m.id] ? (
                                      giftOpenAnimationUrl && !giftOpenPlayedByMessageId[m.id] ? (
                                        <div className="gift-reveal-pop mb-2 overflow-hidden rounded-xl border border-white/25 bg-black/15">
                                          <video
                                            src={giftOpenAnimationUrl}
                                            className="h-28 w-full object-cover"
                                            muted
                                            playsInline
                                            autoPlay
                                            onEnded={() =>
                                              setGiftOpenPlayedByMessageId((prev) => ({
                                                ...prev,
                                                [m.id]: true,
                                              }))
                                            }
                                          />
                                        </div>
                                      ) : (
                                        <div className="gift-reveal-pop mb-2 rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[12px] text-white">
                                          <p className="font-semibold">
                                            {m.gift.emoji ?? '🎁'} cadeau geopend
                                          </p>
                                          <p>{m.gift.packageLabel ?? `${m.gift.credits} credits`}</p>
                                          <p>{m.gift.credits} credits</p>
                                        </div>
                                      )
                                    ) : m.gift.direction === 'to_user' ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setGiftOpenPlayedByMessageId((prev) => {
                                            const { [m.id]: _old, ...rest } = prev;
                                            return rest;
                                          });
                                          openGiftMessage(m.id);
                                        }}
                                        className="gift-box-closed mb-2 w-full overflow-hidden rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-left text-[12px] font-semibold text-white"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-[15px]">🎁</span>
                                          <span>tik om cadeau te openen</span>
                                        </div>
                                        {giftClosedAnimationUrl ? (
                                          <div className="mt-2 overflow-hidden rounded-lg border border-white/20 bg-black/10">
                                            <video
                                              src={giftClosedAnimationUrl}
                                              className="h-24 w-full object-cover"
                                              muted
                                              playsInline
                                              autoPlay
                                              loop
                                            />
                                          </div>
                                        ) : null}
                                      </button>
                                    ) : (
                                      <div className="gift-box-closed mb-2 w-full overflow-hidden rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-left text-[12px] font-semibold text-white/90">
                                        <div className="flex items-center gap-2">
                                          <span className="text-[15px]">🎁</span>
                                          <span>cadeau verstuurd</span>
                                        </div>
                                        {giftClosedAnimationUrl ? (
                                          <div className="mt-2 overflow-hidden rounded-lg border border-white/20 bg-black/10">
                                            <video
                                              src={giftClosedAnimationUrl}
                                              className="h-24 w-full object-cover"
                                              muted
                                              playsInline
                                              autoPlay
                                              loop
                                            />
                                          </div>
                                        ) : null}
                                      </div>
                                    )
                                  ) : null}
                                  <p className="whitespace-pre-wrap">{textBody}</p>
                                  <div className="mt-2 flex items-center justify-end gap-2">
                                    <span
                                      className="select-none text-[11px] font-medium tabular-nums text-white/95"
                                      title={m.createdAt}
                                    >
                                      {formatMessageTime(m.createdAt)}
                                    </span>
                                    {m.readByPeer === false ? (
                                      <Check
                                        className="h-4 w-4 shrink-0 text-white/90"
                                        strokeWidth={2.5}
                                        aria-label="Verzonden"
                                      />
                                    ) : (
                                      <CheckCheck
                                        className="h-4 w-4 shrink-0 text-red-100"
                                        strokeWidth={2.5}
                                        aria-label="Gelezen"
                                      />
                                    )}
                                  </div>
                                </div>
                              ) : m.gift ? (
                                <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-[15px] leading-snug text-white">
                                  {replied ? (
                                    <div className="mb-2 rounded-xl bg-white/10 px-2.5 py-2 text-[12px] leading-snug">
                                      <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">
                                        reply
                                      </div>
                                      <div className="mt-1 line-clamp-2 text-white/90">
                                        {snippetForReply(replied)}
                                      </div>
                                    </div>
                                  ) : null}
                                  {openedGiftByMessageId[m.id] ? (
                                    giftOpenAnimationUrl && !giftOpenPlayedByMessageId[m.id] ? (
                                      <div className="gift-reveal-pop mb-2 overflow-hidden rounded-xl border border-white/25 bg-black/15">
                                        <video
                                          src={giftOpenAnimationUrl}
                                          className="h-28 w-full object-cover"
                                          muted
                                          playsInline
                                          autoPlay
                                          onEnded={() =>
                                            setGiftOpenPlayedByMessageId((prev) => ({
                                              ...prev,
                                              [m.id]: true,
                                            }))
                                          }
                                        />
                                      </div>
                                    ) : (
                                      <div className="gift-reveal-pop mb-2 rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[12px] text-white">
                                        <p className="font-semibold">{m.gift.emoji ?? '🎁'} cadeau geopend</p>
                                        <p>{m.gift.packageLabel ?? `${m.gift.credits} credits`}</p>
                                        <p>{m.gift.credits} credits</p>
                                      </div>
                                    )
                                  ) : m.gift.direction === 'to_user' ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGiftOpenPlayedByMessageId((prev) => {
                                          const { [m.id]: _old, ...rest } = prev;
                                          return rest;
                                        });
                                        openGiftMessage(m.id);
                                      }}
                                      className="gift-box-closed mb-2 w-full overflow-hidden rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-left text-[12px] font-semibold text-white"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-[15px]">🎁</span>
                                        <span>tik om cadeau te openen</span>
                                      </div>
                                      {giftClosedAnimationUrl ? (
                                        <div className="mt-2 overflow-hidden rounded-lg border border-white/20 bg-black/10">
                                          <video
                                            src={giftClosedAnimationUrl}
                                            className="h-24 w-full object-cover"
                                            muted
                                            playsInline
                                            autoPlay
                                            loop
                                          />
                                        </div>
                                      ) : null}
                                    </button>
                                  ) : (
                                    <div className="gift-box-closed mb-2 w-full overflow-hidden rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-left text-[12px] font-semibold text-white/90">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[15px]">🎁</span>
                                        <span>cadeau verstuurd</span>
                                      </div>
                                      {giftClosedAnimationUrl ? (
                                        <div className="mt-2 overflow-hidden rounded-lg border border-white/20 bg-black/10">
                                          <video
                                            src={giftClosedAnimationUrl}
                                            className="h-24 w-full object-cover"
                                            muted
                                            playsInline
                                            autoPlay
                                            loop
                                          />
                                        </div>
                                      ) : null}
                                    </div>
                                  )}
                                  <p className="mt-2 text-right text-[11px] font-medium tabular-nums text-white/95">
                                    {formatMessageTime(m.createdAt)}
                                  </p>
                                </div>
                              ) : null}
                              {!textBody && !m.gift && (
                                <MessageTimestamp
                                  iso={m.createdAt}
                                  align="right"
                                  variant="outgoing-meta"
                                />
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        (() => {
                          const replied = m.replyToId
                            ? displayMessages.find((x) => x.id === m.replyToId)
                            : undefined;
                          return (
                            <div className="flex max-w-[85%] flex-col items-start">
                          <div className="rounded-2xl rounded-bl-sm border border-gray-200/60 bg-[var(--surface-card)] px-4 py-3 text-[15px] leading-snug text-gray-900 shadow-md shadow-black/10">
                            {replied ? (
                              <div className="mb-2 rounded-xl border border-gray-200/60 bg-white px-2.5 py-2 text-[12px] leading-snug text-gray-700">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                  reply
                                </div>
                                <div className="mt-1 line-clamp-2">{snippetForReply(replied)}</div>
                              </div>
                            ) : null}
                            {m.gift ? (
                              openedGiftByMessageId[m.id] ? (
                                giftOpenAnimationUrl && !giftOpenPlayedByMessageId[m.id] ? (
                                  <div className="gift-reveal-pop mb-2 overflow-hidden rounded-xl border border-primary/20 bg-black/5">
                                    <video
                                      src={giftOpenAnimationUrl}
                                      className="h-28 w-full object-cover"
                                      muted
                                      playsInline
                                      autoPlay
                                      onEnded={() =>
                                        setGiftOpenPlayedByMessageId((prev) => ({
                                          ...prev,
                                          [m.id]: true,
                                        }))
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div className="gift-reveal-pop mb-2 rounded-xl border border-primary/20 bg-primary/10 px-2.5 py-2 text-[12px] text-primary">
                                    <p className="font-semibold">
                                      {m.gift.emoji ?? '🎁'} cadeau geopend
                                    </p>
                                    <p>{m.gift.packageLabel ?? `${m.gift.credits} credits`}</p>
                                    <p>{m.gift.credits} credits</p>
                                  </div>
                                )
                              ) : m.gift.direction === 'to_user' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGiftOpenPlayedByMessageId((prev) => {
                                      const { [m.id]: _old, ...rest } = prev;
                                      return rest;
                                    });
                                    openGiftMessage(m.id);
                                  }}
                                  className="gift-box-closed mb-2 w-full overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-r from-primary/15 to-primary/15 px-3 py-2 text-left text-[12px] font-semibold text-primary"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-[15px]">🎁</span>
                                    <span>tik om cadeau te openen</span>
                                  </div>
                                  {giftClosedAnimationUrl ? (
                                    <div className="mt-2 overflow-hidden rounded-lg border border-primary/15 bg-black/5">
                                      <video
                                        src={giftClosedAnimationUrl}
                                        className="h-24 w-full object-cover"
                                        muted
                                        playsInline
                                        autoPlay
                                        loop
                                      />
                                    </div>
                                  ) : null}
                                </button>
                              ) : (
                                <div className="gift-box-closed mb-2 w-full overflow-hidden rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-left text-[12px] font-semibold text-primary">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[15px]">🎁</span>
                                    <span>cadeau verstuurd</span>
                                  </div>
                                  {giftClosedAnimationUrl ? (
                                    <div className="mt-2 overflow-hidden rounded-lg border border-primary/15 bg-black/5">
                                      <video
                                        src={giftClosedAnimationUrl}
                                        className="h-24 w-full object-cover"
                                        muted
                                        playsInline
                                        autoPlay
                                        loop
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              )
                            ) : null}
                            <p className="whitespace-pre-wrap">{m.content}</p>
                          </div>
                          <MessageTimestamp
                            iso={m.createdAt}
                            align="left"
                            variant="incoming"
                          />
                          {/* Realistic read receipt for assistant messages */}
                          {m.role === "assistant" && m.readAt && (
                            <div className="flex items-center gap-1 mt-0.5 pl-3">
                              <span className="text-[10px] text-primary font-medium">✓✓</span>
                              <span className="text-[9px] text-gray-400">
                                gelezen {new Date(m.readAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          )}
                        </div>
                          );
                        })()
                      )}
                      </div>
                    </div>
                  )
                )}
                {/* Typing indicator — ONLY shown when user is sending a message (pendingIndicatorVisible) */}
                {pendingIndicatorVisible && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm border border-gray-200/50 bg-gray-100 px-4 py-3 text-gray-600 shadow-md shadow-black/10">
                      <span className="sr-only">Aan het typen…</span>
                      <span className="flex items-center gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="inline-block h-2 w-2 rounded-full bg-gray-400 typing-dot"
                            style={{ animationDelay: `${i * 0.18}s` }}
                          />
                        ))}
                      </span>
                    </div>
                  </div>
                )}
                </div>
              </div>

              <div className="shrink-0 border-t border-gray-200/70 bg-[var(--surface-card)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px)+4.25rem)] md:p-4 md:pb-4">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png"
                  className="hidden"
                  onChange={handlePickImage}
                />
                {pendingImage && (
                  <div className="relative mx-auto mb-3 max-w-3xl overflow-hidden rounded-2xl border border-gray-200">
                    <img
                      src={pendingImage.previewUrl}
                      alt=""
                      className="max-h-40 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPendingImage(null)}
                      className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white hover:bg-black/70"
                      aria-label="Foto verwijderen"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {showGiftPanel && activeConversation && (
                  <div className="mx-auto mb-3 max-w-3xl rounded-2xl border border-primary/30 bg-primary/[0.06] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-900">
                        🎁 Cadeau sturen aan {activeConversation.profileName}
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowGiftPanel(false)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        aria-label="Sluit cadeaupaneel"
                      >
                        <X className="h-3.5 w-3.5" />
                        Sluit
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {CHAT_GIFT_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            void handleSendGift(
                              opt.credits,
                              `${opt.priceLabel} voor ${opt.credits} credits voor ${activeConversation.profileName}`
                            )
                          }
                          className={`rounded-xl border px-3 py-2 text-left ${
                            opt.featured
                              ? 'border-primary bg-white shadow-sm'
                              : 'border-gray-200 bg-white'
                          }`}
                        >
                          <p className="text-xs text-gray-500">{opt.priceLabel}</p>
                          <p className="font-semibold text-gray-900">{opt.credits} credits</p>
                          <p className="text-[11px] text-gray-600">
                            voor {activeConversation.profileName}
                          </p>
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={giftNote}
                      onChange={(e) => setGiftNote(e.target.value)}
                      placeholder="Berichtje bij je cadeau..."
                      className="mt-2 min-h-[48px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base md:min-h-0 md:text-sm"
                    />
                  </div>
                )}
                <div className="mx-auto w-full max-w-3xl space-y-2">
                  {replyToId && (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          reply
                        </div>
                        <div className="mt-1 truncate text-gray-700">
                          {snippetForReply(displayMessages.find((x) => x.id === replyToId))}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyToId(null)}
                        className="shrink-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                      >
                        annuleer
                      </button>
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <div className="relative shrink-0" ref={attachMenuRef}>
                      <button
                        type="button"
                        disabled={sendingHere}
                        onClick={() => setAttachMenuOpen((v) => !v)}
                        className="flex h-12 min-h-[48px] w-12 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
                        aria-expanded={attachMenuOpen}
                        aria-haspopup="true"
                        aria-label="Meer opties"
                      >
                        <MoreVertical className="h-6 w-6" />
                      </button>
                      {attachMenuOpen ? (
                        <div
                          className="absolute bottom-full left-0 z-30 mb-2 w-60 overflow-hidden rounded-2xl border border-gray-200 bg-white py-1 shadow-lg"
                          role="menu"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            disabled={sendingHere}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-base font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                            onClick={() => {
                              imageInputRef.current?.click();
                              setAttachMenuOpen(false);
                            }}
                          >
                            <ImagePlus className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                            Foto toevoegen
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={sendingHere}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-base font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                            onClick={() => {
                              setShowGiftPanel((v) => !v);
                              setAttachMenuOpen(false);
                            }}
                          >
                            <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                            Cadeau sturen
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={sendingHere}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-base font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                            onClick={() => {
                              void toggleVoiceRecording();
                            }}
                          >
                            {isRecordingVoice ? (
                              <Pause className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                            ) : (
                              <Mic className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                            )}
                            {isRecordingVoice ? 'Opname stoppen' : 'Spraak inspreken'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <textarea
                      ref={composerTextareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder="Typ je bericht… (Shift+Enter voor nieuwe regel)"
                      rows={2}
                      disabled={false}
                      className="max-h-32 min-h-[3.25rem] flex-1 resize-y rounded-2xl border border-gray-200 px-3 py-3 text-base leading-snug text-gray-900 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 md:min-h-[3.5rem] md:text-[15px]"
                    />
                    <Button
                      type="button"
                      onClick={handleSend}
                      disabled={!input.trim() && !pendingImage}
                      className="flex h-12 min-h-[48px] min-w-[6.5rem] shrink-0 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-base font-semibold text-white shadow-sm transition-all active:scale-[0.97] hover:bg-primary/90"
                    >
                      Verstuur
                    </Button>
                  </div>
                  {(isRecordingVoice || voiceDraftBlob) && (
                    <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (isRecordingVoice) void toggleVoiceRecording();
                          }}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white"
                          title={isRecordingVoice ? 'Stop opname' : 'Opname klaar'}
                        >
                          {isRecordingVoice ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Mic className="h-4 w-4" />
                          )}
                        </button>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          {isRecordingVoice ? (
                            <div className="flex items-end gap-1">
                              {[0, 1, 2, 3, 4].map((i) => (
                                <span
                                  key={i}
                                  className="inline-block w-1.5 rounded-full bg-primary/80 animate-pulse"
                                  style={{
                                    height: `${10 + ((i % 3) + 1) * 5}px`,
                                    animationDelay: `${i * 120}ms`,
                                  }}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs font-medium text-gray-600">Opname klaar</div>
                          )}
                          <div className="text-sm font-semibold tabular-nums text-gray-800">
                            {formatRecordingDuration(recordingSeconds)}
                          </div>
                        </div>
                      </div>
                      {!isRecordingVoice && voiceDraftTranscript.trim() && (
                        <div className="max-w-[220px] truncate text-xs text-gray-500">
                          "{voiceDraftTranscript.trim()}"
                        </div>
                      )}
                      <Button
                        type="button"
                        onClick={sendVoiceDraft}
                        disabled={isRecordingVoice || !voiceDraftBlob}
                        className="h-10 min-w-[7rem] rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                      >
                        Verzend spraakbericht
                      </Button>
                      {!isRecordingVoice && (
                        <button
                          type="button"
                          onClick={cancelVoiceDraft}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                          title="Verwijder opname"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {selectedId && !loadingMessages && !activeConversation && (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
              <p className="text-lg font-semibold text-gray-900">Gesprek niet gevonden</p>
              <p className="mt-2 max-w-sm text-sm text-gray-600">
                Dit gesprek bestaat niet meer of is niet beschikbaar. Kies een gesprek uit je inbox.
              </p>
              <Button
                type="button"
                onClick={backToList}
                className="mt-5 rounded-2xl bg-primary px-6 py-2.5 text-white hover:bg-primary/90"
              >
                Terug naar berichten
              </Button>
            </div>
          )}

          {!selectedId && !openingProfileDeepLink && !loadingList && list.length === 0 && (
            <EmptyState />
          )}
          {!selectedId && !openingProfileDeepLink && !loadingList && list.length > 0 && (
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
              <p className="text-lg font-semibold text-gray-900">Selecteer een gesprek</p>
              <p className="text-sm text-gray-600 mt-2 max-w-sm">
                Je hebt al chats — klik links op een naam om het gesprek te openen.
              </p>
            </div>
          )}
        </div>

        <CreditsSidebar balance={creditsBalance} onBuyCredits={openPricing} />
        </div>
      </div>
      {/* Desktop live notifications (right-bottom) */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[90] hidden w-[320px] max-w-[92vw] flex-col gap-3 md:flex">
        {liveNotifications.map((n) => (
          <div
            key={n.id}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white px-3 py-3 shadow-lg"
          >
            <img
              src={n.avatar}
              alt=""
              className="h-11 w-11 shrink-0 rounded-xl object-cover ring-2 ring-white shadow-sm"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{n.profileName}</p>
              <p className="truncate text-xs text-gray-600">{n.text}</p>
            </div>
          </div>
        ))}
      </div>

      {lightboxSrc ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Vergrote foto"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/92 p-3"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            className="absolute right-3 top-3 z-[201] rounded-full bg-white/15 p-2.5 text-white hover:bg-white/25"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxSrc(null);
            }}
            aria-label="Sluiten"
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxSrc}
            alt=""
            className="max-h-[min(92dvh,92vh)] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function BerichtenPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500">
          Laden…
        </div>
      }
    >
      <BerichtenInner />
    </Suspense>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-8 relative w-36 h-36 md:w-44 md:h-44">
          <div className="absolute inset-0 border-[14px] border-gray-200 rounded-full" />
          <div className="absolute top-8 right-6 w-20 h-5 bg-gray-300 rotate-45 origin-left rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center text-7xl opacity-30">
            🔍
          </div>
          <div className="absolute -bottom-1 -right-1 bg-white rounded-3xl shadow-lg p-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
        </div>
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
          Geen chats hier nog
        </h2>
        <p className="text-gray-500 mb-10">
          Spark nieuwe chats met ijsbrekers
        </p>
        <div className="relative mx-auto w-56 h-56 mb-10">
          <div className="absolute inset-0 border border-dashed border-gray-300 rounded-full" />
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-14 h-14 rounded-2xl overflow-hidden border-4 border-white shadow-md">
            <img
              src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200"
              alt=""
              className="object-cover w-full h-full"
            />
          </div>
          <div className="absolute bottom-10 left-6 w-12 h-12 rounded-2xl overflow-hidden border-4 border-white shadow-md">
            <img
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200"
              alt=""
              className="object-cover w-full h-full"
            />
          </div>
          <div className="absolute bottom-10 right-6 w-12 h-12 rounded-2xl overflow-hidden border-4 border-white shadow-md">
            <img
              src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=200"
              alt=""
              className="object-cover w-full h-full"
            />
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white shadow-xl rounded-2xl px-6 py-4 border border-gray-100">
            <div className="font-bold text-primary text-xs tracking-widest">START HIER</div>
          </div>
        </div>
        <Link
          href="/profielen"
          className="inline-flex w-full max-w-xs justify-center rounded-2xl bg-primary px-8 py-4 text-base font-semibold text-white shadow-sm hover:bg-primary-hover transition-colors"
        >
          Bekijk profielen om te chatten
        </Link>
      </div>
    </div>
  );
}

function CreditsSidebar({
  balance,
  onBuyCredits,
}: {
  balance: number;
  onBuyCredits: () => void;
}) {
  return (
    <div className="hidden lg:flex lg:min-h-0 lg:max-h-full lg:w-full lg:max-w-[360px] lg:flex-shrink-0 lg:flex-col lg:overflow-y-auto lg:border-l lg:border-gray-200/80 lg:bg-[var(--surface-card)] lg:p-6">
      <div className="bg-gradient-to-br from-primary to-primary-deep text-white rounded-3xl p-6 shadow-xl">
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="uppercase tracking-wider text-[10px] opacity-80">FOTO PASS</div>
            <div className="text-2xl font-bold mt-1 leading-tight">
              Foto’s ontgrendelen
            </div>
            <p className="text-xs opacity-85 mt-2 leading-snug">
              Chatten kost geen credits · 1 foto = {CREDITS_PER_PHOTO_UNLOCK} credits (€10) · actie 3
              foto&apos;s €19,99 i.p.v. €29,99
            </p>
          </div>
          <CreditCard className="w-8 h-8 opacity-80" />
        </div>
        <ul className="space-y-3 text-sm border-t border-white/20 pt-4">
          <li className="flex justify-between gap-2 font-semibold">
            <span>1 foto (100 credits)</span>
            <span>€10,00</span>
          </li>
          <li className="flex justify-between gap-2 text-sm opacity-95">
            <span>2 foto&apos;s (200 credits)</span>
            <span>€20,00</span>
          </li>
          <li className="flex justify-between gap-2 text-sm opacity-90">
            <span>3 foto&apos;s (300 credits)</span>
            <span>
              <span className="mr-1.5 line-through opacity-75">€29,99</span>
              €19,99 actie
            </span>
          </li>
        </ul>
        <ul className="space-y-4 text-sm mt-4">
          <li className="flex gap-3">
            <span className="text-lg">💬</span> Chatten zonder credits
          </li>
          <li className="flex gap-3">
            <span className="text-lg">📸</span> Custom foto’s op aanvraag
          </li>
          <li className="flex gap-3">
            <span className="text-lg">⚡️</span> Direct te ontgrendelen
          </li>
        </ul>
        <Button
          type="button"
          variant="accent"
          className="w-full mt-8 py-4 bg-white text-primary hover:bg-white/90 rounded-2xl"
          onClick={onBuyCredits}
        >
          Koop Credits <ArrowRight className="inline ml-1 w-4 h-4" />
        </Button>
        <p className="text-center text-xs mt-4 opacity-70">
          {CREDITS_PER_MESSAGE <= 0 ? (
            balance < CREDITS_PER_PHOTO_UNLOCK ? (
              <span>
                Nog {balance} credits. Voor het ontgrendelen van een foto heb je {CREDITS_PER_PHOTO_UNLOCK}{' '}
                credits nodig (tarief: €10 per foto).
              </span>
            ) : (
              <>Je hebt {balance} credits voor foto&apos;s.</>
            )
          ) : balance < CREDITS_PER_PHOTO_UNLOCK ? (
            <span className="font-semibold">
              Te weinig credits voor een foto — open prijzen om bij te kopen.
            </span>
          ) : (
            <>Je hebt nog {balance} credits</>
          )}
        </p>
      </div>
    </div>
  );
}
