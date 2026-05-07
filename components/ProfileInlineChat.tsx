'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ChatMessage, Conversation } from '@/lib/types/chat';
import { sortChatMessagesChronologically } from '@/lib/chat-message-order';
import { Button } from '@/components/ui/button';
import {
  getCreditsBalance,
  spendChatCredit,
  refundChatCredit,
  CREDITS_PER_MESSAGE,
  creditsCostForBatchSize,
} from '@/lib/credits-client';
import { useCreditsPricing } from '@/components/CreditsPricingProvider';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('nl-NL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-2">
      <span
        className="typing-dot inline-block h-2 w-2 rounded-full bg-gray-400"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="typing-dot inline-block h-2 w-2 rounded-full bg-gray-400"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="typing-dot inline-block h-2 w-2 rounded-full bg-gray-400"
        style={{ animationDelay: '300ms' }}
      />
    </div>
  );
}

/** Deduplicate optimistic + server chat messages in profile chat. */
function deduplicateMessages(messages: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const signatureToId = new Map<string, string>();
  const now = Date.now();

  for (const msg of messages) {
    const contentKey = (msg.content || '').trim().toLowerCase();
    const msgTime = Date.parse(msg.createdAt);
    const timeKey = Math.floor((Number.isFinite(msgTime) ? msgTime : now) / 3000);
    const signature = `${msg.role}:${contentKey}:${timeKey}`;

    const existingIdForSignature = signatureToId.get(signature);
    if (existingIdForSignature) {
      const existing = byId.get(existingIdForSignature);
      if (existing) {
        if (!msg.id.startsWith('optimistic-') && existing.id.startsWith('optimistic-')) {
          byId.delete(existing.id);
          byId.set(msg.id, msg);
          signatureToId.set(signature, msg.id);
        }
        continue;
      }
    }

    if (byId.has(msg.id)) continue;
    byId.set(msg.id, msg);
    if (contentKey) signatureToId.set(signature, msg.id);
  }

  return Array.from(byId.values());
}

type PostMessagesResponse = {
  error?: string;
  creditWall?: boolean;
  userMessages?: ChatMessage[];
  assistantMessage?: ChatMessage | null;
};

type Props = {
  conversationId: string | null;
  profileName: string;
  profileAvatar: string;
};

export function ProfileInlineChat({
  conversationId,
  profileName,
  profileAvatar,
}: Props) {
  const router = useRouter();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingConversationId, setSendingConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sendCostTip, setSendCostTip] = useState(false);
  const [optimisticOutgoing, setOptimisticOutgoing] = useState<ChatMessage[]>([]);
  const longPressTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { openPricing } = useCreditsPricing();

  const sortedServerMessages = useMemo(
    () => (conversation?.messages ? sortChatMessagesChronologically(conversation.messages) : []),
    [conversation?.messages]
  );

  const displayMessages = useMemo(
    () => sortChatMessagesChronologically(
      deduplicateMessages([...sortedServerMessages, ...optimisticOutgoing])
    ),
    [sortedServerMessages, optimisticOutgoing]
  );

  const lastDisplayId =
    displayMessages.length > 0 ? displayMessages[displayMessages.length - 1]!.id : '';

  const userMessageCount = sortedServerMessages.filter((m) => m.role === 'user').length;
  const isFirstUserMessage = userMessageCount === 0;
  const threadLenDisplay = displayMessages.length;

  const showComposer = Boolean(conversation && !loading);
  const sendingHere = Boolean(conversationId && sendingConversationId === conversationId);

  const fetchConv = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (!conversationId) {
        setConversation(null);
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      if (!silent) setError(null);
      try {
        const res = await fetch(`/api/conversations/${conversationId}`, {
          credentials: 'include',
        });
        const data = (await res.json()) as { conversation?: Conversation; error?: string };
        if (!res.ok) throw new Error(data.error || 'Gesprek laden mislukt');
        const incoming = data.conversation ?? null;
        if (silent && incoming) {
          setConversation((prev) => {
            if (!prev || prev.id !== incoming.id) return incoming;
            const incomingIds = new Set(incoming.messages.map((m) => m.id));
            const carryOver = prev.messages.filter((m) => !incomingIds.has(m.id));
            if (carryOver.length === 0) return incoming;
            const merged = deduplicateMessages([...incoming.messages, ...carryOver]);
            return {
              ...incoming,
              messages: sortChatMessagesChronologically(merged),
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
        if (!silent) {
          setError(e instanceof Error ? e.message : 'Fout');
          setConversation(null);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    setOptimisticOutgoing([]);
    void fetchConv({ silent: false });
  }, [conversationId, fetchConv]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const run = () => {
      el.scrollTop = el.scrollHeight;
    };
    run();
    requestAnimationFrame(run);
    window.setTimeout(run, 50);
  }, [threadLenDisplay, loading, sendingHere, lastDisplayId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !conversationId) return;
    const ro = new ResizeObserver(() => {
      const threshold = 120;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (dist < threshold) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [conversationId, conversation?.id]);

  // Profile chat is "send-only": na versturen redirect naar volledige inbox.

  const sendText = async (text: string, opts?: { noCredits?: boolean }) => {
    if (!conversationId) return;
    if (sendingConversationId === conversationId) return;
    const trimmed = text.trim();
    const noCredits = opts?.noCredits === true;
    if (!noCredits && !trimmed) return;

    const firstFree = !noCredits && userMessageCount === 0;

    if (!noCredits && !firstFree && getCreditsBalance() < CREDITS_PER_MESSAGE) {
      void fetch(`/api/conversations/${conversationId}/credit-runout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
      openPricing();
      return;
    }

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMsg: ChatMessage = {
      id: optimisticId,
      role: 'user',
      content: trimmed || '😉',
      createdAt: new Date().toISOString(),
      readByPeer: false,
    };
    setOptimisticOutgoing((prev) => [...prev, optimisticMsg]);
    setSendingConversationId(conversationId);
    setError(null);

    const shouldCharge = !noCredits && !firstFree;
    const chargeAmount = creditsCostForBatchSize(1);
    if (shouldCharge) {
      spendChatCredit(chargeAmount);
      if (getCreditsBalance() < CREDITS_PER_MESSAGE) {
        void fetch(`/api/conversations/${conversationId}/credit-runout`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => {});
      }
    }

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          noCredits
            ? { items: [{ text: trimmed || '😉' }], noCredits: true }
            : { items: [{ text: trimmed }] }
        ),
      });
      const data = (await res.json()) as PostMessagesResponse;
      if (!res.ok) throw new Error(data.error || 'Versturen mislukt');

      if (data.creditWall) {
        if (shouldCharge) refundChatCredit(chargeAmount);
        openPricing();
        return;
      }

      // Immediately redirect to the full inbox chat after successful send.
      // The profile inline chat is no longer used for ongoing conversation.
      router.push(`/berichten?chat=${conversationId}`);
    } catch (e) {
      if (shouldCharge) refundChatCredit(chargeAmount);
      setOptimisticOutgoing((prev) => prev.filter((m) => m.id !== optimisticId));
      setError(e instanceof Error ? e.message : 'Fout bij versturen');
    } finally {
      setSendingConversationId((prev) => (prev === conversationId ? null : prev));
    }
  };

  const clearLongPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const onSendPointerDown = () => {
    if (isFirstUserMessage) return;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => setSendCostTip(true), 450);
  };

  const onSendPointerUp = () => {
    clearLongPress();
    window.setTimeout(() => setSendCostTip(false), 1600);
  };

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center py-12 text-sm text-gray-500">
        Chat wordt geopend…
      </div>
    );
  }

  const showAssistantTyping = sendingHere && !optimisticOutgoing.length; // only show very briefly

  return (
    <div className="flex h-full min-h-0 flex-1 touch-manipulation flex-col bg-white">
      {/* Desktop: chat-peer header — verborgen op mobiel (zit in profiel-header) */}
      <div className="hidden items-center gap-3 border-b border-gray-100 px-4 py-3 md:flex">
        <img
          src={profileAvatar}
          alt=""
          className="h-10 w-10 shrink-0 rounded-2xl object-cover ring-2 ring-primary/20"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-gray-900">{profileName}</p>
          <p className="text-xs font-medium text-emerald-600">Online</p>
        </div>
        <Link
          href={`/berichten?chat=${conversationId}`}
          className="shrink-0 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-primary transition-conv hover:bg-primary/5"
        >
          Naar inbox
        </Link>
      </div>

      {error && (
        <div className="mx-3 mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 transition-conv">
          {error}
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 [-webkit-overflow-scrolling:touch] md:max-h-[min(52vh,420px)] md:min-h-[200px]"
      >
        {loading && !conversation ? (
          <p className="py-6 text-center text-sm text-gray-500">Berichten laden…</p>
        ) : (
          <div className="flex min-h-full flex-col gap-3 py-2">
            {(displayMessages.length > 0 || showAssistantTyping) && <div className="mt-auto" />}
            {displayMessages.map((m: ChatMessage) => (
              <div
                key={m.id}
                className={`flex w-full min-w-0 transition-conv ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[min(88%,100vw-2.5rem)] break-words rounded-2xl px-3 py-2.5 text-base leading-snug md:max-w-[88%] md:text-sm ${
                    m.role === 'user'
                      ? 'bg-primary text-white'
                      : 'border border-gray-200 bg-gray-50 text-gray-900'
                  } ${m.id.startsWith('optimistic-') ? 'opacity-95 ring-2 ring-white/40' : ''}`}
                >
                  {m.gift ? (
                    <p className="mb-1 text-xs font-semibold opacity-90">
                      {m.gift.emoji ?? '🎁'}{' '}
                      {m.gift.direction === 'to_user' ? 'cadeau ontvangen' : 'cadeau'}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <p
                    className={`mt-1.5 text-[11px] font-medium tabular-nums ${
                      m.role === 'user' ? 'text-white/95' : 'text-gray-500'
                    }`}
                  >
                    {formatTime(m.createdAt)}
                  </p>
                </div>
              </div>
            ))}

            {/* Loading dots only shown very briefly (3-10s before reply) in full inbox.
                 Profile chat no longer shows ongoing conversation. */}
            {showAssistantTyping && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showComposer && (
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-gray-100 bg-white/95 px-3 py-3 backdrop-blur-sm transition-conv pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {isFirstUserMessage && threadLenDisplay === 0 ? (
            <p className="mb-2 text-center text-xs font-medium text-primary">
              Eerste bericht gratis ✨
            </p>
          ) : null}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 sm:flex-row sm:items-stretch">
            <input
              type="text"
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void sendText(input);
                }
              }}
              placeholder={`Bericht aan ${profileName}…`}
              disabled={sendingHere}
              className="min-h-[52px] w-full min-w-0 flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-base transition-conv focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 md:min-h-[44px] md:text-sm"
            />
            <div className="relative flex shrink-0 justify-end sm:justify-stretch">
              {sendCostTip && !isFirstUserMessage && (
                <div className="absolute bottom-full right-0 z-20 mb-1 whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-[10px] font-medium text-white shadow-lg">
                  {CREDITS_PER_MESSAGE} credits
                </div>
              )}
              <Button
                type="button"
                title={
                  !isFirstUserMessage
                    ? `${CREDITS_PER_MESSAGE} credits per bericht`
                    : 'Eerste bericht gratis'
                }
                className="h-12 min-h-[48px] w-full min-w-[48px] rounded-2xl px-5 sm:h-auto sm:w-auto sm:min-w-[100px]"
                disabled={sendingHere || !input.trim()}
                onPointerDown={onSendPointerDown}
                onPointerUp={onSendPointerUp}
                onPointerLeave={onSendPointerUp}
                onClick={() => void sendText(input)}
              >
                Verstuur
              </Button>
            </div>
          </div>
          <Link
            href={`/berichten?chat=${conversationId}`}
            className="mt-2 block text-center text-[11px] font-medium text-primary transition-conv hover:underline"
          >
            Naar inbox
          </Link>
        </div>
      )}
    </div>
  );
}
