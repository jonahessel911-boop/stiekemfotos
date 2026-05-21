'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Conversation, ConversationSummary, ChatMessage } from '@/lib/types/chat';
import { sortChatMessagesChronologically } from '@/lib/chat-message-order';
import {
  CREDITS_PER_MESSAGE,
  getCreditsBalance,
  spendChatCredit,
  refundChatCredit,
} from '@/lib/credits-client';
import { scheduleTypingIndicatorFromEvents } from '@/lib/chat-typing-indicator';
import { avatarUrlForSummary, formatP2MessageTime } from '@/lib/platform2-chat-utils';
import { resolveProfileImageUrl } from '@/lib/profile-image-url';

export default function Platform2Chat() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const profileParam = searchParams.get('profile')?.trim() ?? '';

  const [list, setList] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingPlaybackCleanupRef = useRef<(() => void) | null>(null);
  const chatHistoryPushedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncCredits = useCallback(() => setCredits(getCreditsBalance()), []);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations', { credentials: 'include' });
      const data = (await res.json()) as { conversations?: ConversationSummary[]; error?: string };
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/platform/2/aanmelden?next=%2Fplatform%2F2%2Fberichten';
          return;
        }
        throw new Error(data.error || 'Inbox laden mislukt');
      }
      setList(data.conversations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const fetchThread = useCallback(async (id: string, soft = false) => {
    if (!soft) setLoadingThread(true);
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(28_000),
      });
      const data = (await res.json()) as { conversation?: Conversation; error?: string };
      if (!res.ok) throw new Error(data.error || 'Gesprek niet gevonden');
      if (data.conversation) {
        setConversation(data.conversation);
        typingPlaybackCleanupRef.current?.();
        typingPlaybackCleanupRef.current = null;
        setPeerTyping(false);
      }
    } catch (e) {
      if (!soft) setError(e instanceof Error ? e.message : 'Fout');
    } finally {
      if (!soft) setLoadingThread(false);
    }
  }, []);

  const openThread = useCallback(
    (id: string) => {
      setSelectedId(id);
      setError(null);
      if (
        typeof window !== 'undefined' &&
        window.matchMedia('(max-width: 1023px)').matches &&
        !chatHistoryPushedRef.current
      ) {
        window.history.pushState({ platform2ChatThread: true }, '', window.location.href);
        chatHistoryPushedRef.current = true;
      }
      void fetchThread(id);
    },
    [fetchThread]
  );

  const openProfileChat = useCallback(
    async (profileId: string) => {
      setError(null);
      setLoadingThread(true);
      try {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId }),
        });
        const data = (await res.json()) as { conversation?: Conversation; error?: string };
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = `/platform/2/aanmelden?next=${encodeURIComponent(`/platform/2/berichten?profile=${profileId}`)}`;
            return;
          }
          throw new Error(data.error || 'Chat starten mislukt');
        }
        const conv = data.conversation;
        if (!conv?.id) throw new Error('Geen gesprek');
        setConversation(conv);
        setSelectedId(conv.id);
        if (
          typeof window !== 'undefined' &&
          window.matchMedia('(max-width: 1023px)').matches &&
          !chatHistoryPushedRef.current
        ) {
          window.history.pushState({ platform2ChatThread: true }, '', window.location.href);
          chatHistoryPushedRef.current = true;
        }
        await fetchList();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fout');
      } finally {
        setLoadingThread(false);
      }
    },
    [fetchList]
  );

  useEffect(() => {
    const onPop = () => {
      if (!chatHistoryPushedRef.current) return;
      chatHistoryPushedRef.current = false;
      setSelectedId(null);
      setConversation(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    syncCredits();
    void fetchList();
    const onCredits = () => syncCredits();
    window.addEventListener('dm-credits-updated', onCredits);
    return () => window.removeEventListener('dm-credits-updated', onCredits);
  }, [fetchList, syncCredits]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!selectedId) return;
    pollRef.current = setInterval(() => {
      void fetchThread(selectedId, true);
    }, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedId, fetchThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages.length, peerTyping]);

  useEffect(() => {
    return () => {
      typingPlaybackCleanupRef.current?.();
    };
  }, []);

  const send = async () => {
    const text = draft.trim();
    const sid = selectedId;
    if (!text || !sid || sending) return;
    if (credits < CREDITS_PER_MESSAGE) {
      setError('Geen credits meer. Koop credits om door te chatten.');
      return;
    }
    setSending(true);
    setError(null);
    setDraft('');
    spendChatCredit(CREDITS_PER_MESSAGE);
    syncCredits();
    typingPlaybackCleanupRef.current?.();
    typingPlaybackCleanupRef.current = null;
    setPeerTyping(false);

    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setConversation((c) =>
      c && c.id === sid
        ? {
            ...c,
            messages: sortChatMessagesChronologically([...c.messages, optimistic]),
          }
        : c
    );

    try {
      const res = await fetch(`/api/conversations/${sid}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
        signal: AbortSignal.timeout(230_000),
      });
      const data = (await res.json()) as {
        error?: string;
        creditWall?: boolean;
        userMessages?: ChatMessage[];
        assistantMessage?: ChatMessage | null;
      };
      if (!res.ok) throw new Error(data.error || 'Versturen mislukt');
      if (data.creditWall) {
        refundChatCredit(CREDITS_PER_MESSAGE);
        syncCredits();
        setError('Credits op. Koop meer om te antwoorden.');
        setPeerTyping(false);
        return;
      }

      const assistant = data.assistantMessage ?? null;
      const userMsgs = data.userMessages ?? [];

      if (assistant?.typingEvents?.length) {
        setConversation((c) => {
          if (!c || c.id !== sid) return c;
          const withoutOpt = c.messages.filter((m) => m.id !== optimistic.id);
          const ids = new Set(withoutOpt.map((m) => m.id));
          const freshUser = userMsgs.filter((m) => !ids.has(m.id));
          return {
            ...c,
            messages: sortChatMessagesChronologically([...withoutOpt, ...freshUser]),
          };
        });
        typingPlaybackCleanupRef.current?.();
        typingPlaybackCleanupRef.current = scheduleTypingIndicatorFromEvents(
          assistant.typingEvents,
          setPeerTyping
        );
        const assistantToShow = assistant;
        window.setTimeout(() => {
          typingPlaybackCleanupRef.current?.();
          typingPlaybackCleanupRef.current = null;
          setPeerTyping(false);
          setConversation((c) => {
            if (!c || c.id !== sid) return c;
            const ids = new Set(c.messages.map((m) => m.id));
            if (ids.has(assistantToShow.id)) return c;
            return {
              ...c,
              messages: sortChatMessagesChronologically([...c.messages, assistantToShow]),
            };
          });
        }, typingPlaybackDurationMs(assistant.typingEvents));
      } else {
        setConversation((c) => {
          if (!c || c.id !== sid) return c;
          const add = [...userMsgs, ...(assistant ? [assistant] : [])];
          const ids = new Set(c.messages.map((m) => m.id));
          const fresh = add.filter((m) => !ids.has(m.id));
          const withoutOpt = c.messages.filter((m) => m.id !== optimistic.id);
          return {
            ...c,
            messages: sortChatMessagesChronologically([...withoutOpt, ...fresh]),
          };
        });
        setPeerTyping(false);
      }
      void fetchList();
    } catch (e) {
      refundChatCredit(CREDITS_PER_MESSAGE);
      syncCredits();
      setConversation((c) =>
        c && c.id === sid
          ? { ...c, messages: c.messages.filter((m) => m.id !== optimistic.id) }
          : c
      );
      setError(e instanceof Error ? e.message : 'Versturen mislukt');
      setPeerTyping(false);
    } finally {
      setSending(false);
    }
  };

  function typingPlaybackDurationMs(events: NonNullable<ChatMessage['typingEvents']>): number {
    if (!events?.length) return 0;
    const base = new Date(events[0]!.startedAt).getTime();
    const end = events.reduce((max, ev) => {
      const t = [new Date(ev.startedAt).getTime()];
      if (ev.stoppedAt) t.push(new Date(ev.stoppedAt).getTime());
      return Math.max(max, ...t);
    }, base);
    return Math.max(0, end - base) + 120;
  }

  const backToInbox = () => {
    if (chatHistoryPushedRef.current) {
      chatHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    setSelectedId(null);
    setConversation(null);
  };

  const bootedProfile = useRef(false);
  useEffect(() => {
    if (!profileParam || bootedProfile.current) return;
    bootedProfile.current = true;
    void openProfileChat(profileParam);
    router.replace('/platform/2/berichten', { scroll: false });
  }, [profileParam, openProfileChat, router]);

  return (
    <div className={`platform2-chat ${selectedId ? 'platform2-chat--thread-open' : ''}`}>
      {selectedId ? (
        <div className="platform2-chat-nav">
          <button type="button" className="platform2-chat-back" onClick={backToInbox}>
            ← Terug naar berichten
          </button>
        </div>
      ) : null}
      <div className="platform2-chat-inbox">
        <div className="platform2-chat-inbox-head">
          <strong>Mijn berichten</strong>
          <span className="platform2-chat-credits">{credits} credits</span>
        </div>
        {error && !selectedId ? <div className="platform2-error">{error}</div> : null}
        {loadingList ? (
          <p className="platform2-chat-empty">Laden…</p>
        ) : list.length === 0 ? (
          <p className="platform2-chat-empty">
            Nog geen gesprekken.{' '}
            <Link href="/platform/2/profielen">Zoek iemand</Link> en stuur een bericht.
          </p>
        ) : (
          <ul className="platform2-chat-list">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`platform2-chat-row ${selectedId === c.id ? 'active' : ''}`}
                  onClick={() => openThread(c.id)}
                >
                  <img src={avatarUrlForSummary(c)} alt="" width={44} height={44} />
                  <span className="platform2-chat-row-body">
                    <span className="platform2-chat-row-top">
                      <b>{c.profileName}</b>
                      <small>{c.timestamp}</small>
                    </span>
                    <span
                      className={
                        c.lastMessageFromAssistant ? 'platform2-chat-preview new' : 'platform2-chat-preview'
                      }
                    >
                      {c.lastMessage || 'Nieuw gesprek'}
                    </span>
                  </span>
                  {c.unread > 0 ? <span className="platform2-chat-badge">{c.unread}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="platform2-chat-thread">
        {!selectedId ? (
          <div className="platform2-chat-placeholder">
            <p>Kies een gesprek links, of ga naar <Link href="/platform/2/profielen">profielen</Link>.</p>
          </div>
        ) : (
          <>
            <div className="platform2-chat-thread-head">
              {conversation ? (
                <>
                  <img
                    src={resolveProfileImageUrl(conversation.previewAvatar) || '/logo-mark.png'}
                    alt=""
                    width={36}
                    height={36}
                  />
                  <div>
                    <b>{conversation.profileName}</b>
                    {conversation.isOnline ? (
                      <span className="platform2-online"> online</span>
                    ) : null}
                  </div>
                </>
              ) : null}
              <Link
                href="/platform/2/credits"
                className="platform2-btn"
                style={{ marginLeft: 'auto', fontSize: 11 }}
              >
                + Credits
              </Link>
            </div>

            {error ? <div className="platform2-error" style={{ margin: 8 }}>{error}</div> : null}

            <div className="platform2-chat-messages">
              {loadingThread && !conversation ? (
                <p className="platform2-chat-empty">Gesprek laden…</p>
              ) : (
                <>
                  {(conversation?.messages ?? []).map((m) => (
                    <div
                      key={m.id}
                      className={
                        m.role === 'user'
                          ? 'platform2-bubble platform2-bubble-out'
                          : 'platform2-bubble platform2-bubble-in'
                      }
                    >
                      <p>{m.content || (m.imageUrl ? '📷 Foto' : '…')}</p>
                      <small>{formatP2MessageTime(m.createdAt)}</small>
                    </div>
                  ))}
                  {peerTyping ? (
                    <div className="platform2-bubble platform2-bubble-in platform2-typing">
                      <span className="sr-only">
                        {conversation?.profileName ?? 'Ze'} is aan het typen
                      </span>
                      <span className="platform2-typing-dots" aria-hidden>
                        <span className="typing-dot" />
                        <span className="typing-dot" style={{ animationDelay: '0.18s' }} />
                        <span className="typing-dot" style={{ animationDelay: '0.36s' }} />
                      </span>
                    </div>
                  ) : null}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            <form
              className="platform2-chat-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                type="text"
                placeholder="Typ je bericht…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={sending}
              />
              <button type="submit" className="platform2-btn" disabled={sending || !draft.trim()}>
                {sending ? '…' : 'Verstuur'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
