'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ConversationSummary, Conversation, ChatMessage } from '@/lib/types/chat';
import {
  triggersAssistantVoiceReply,
  triggersTrustProofVoiceRequest,
} from '@/lib/flirt-triggers';
import { intimacyTierFromCount } from '@/lib/intimacy-tier';
import {
  getCreditsBalance,
  spendChatCredit,
  creditsCostForBatchSize,
  CREDITS_PER_MESSAGE,
  INITIAL_FREE_CREDITS,
} from '@/lib/credits-client';
import { useCreditsPricing } from '@/components/CreditsPricingProvider';
import {
  FEATURED_DEAL_PRICE_LABEL,
  FEATURED_DEAL_CREDITS,
  FEATURED_DEAL_WAS_PRICE_LABEL,
  FEATURED_DEAL_DISCOUNT_PERCENT,
} from '@/lib/credit-packages';
import {
  MAX_OUTGOING_BATCH_SIZE,
  MAX_USER_MESSAGE_CHARS,
} from '@/lib/chat-send-limits';
import {
  formatLastOnlineAgo,
  lastAssistantMessageAt,
  syntheticLastSeenMinutes,
} from '@/lib/peer-presence';

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

function MessageTimestamp({
  iso,
  align,
  variant,
}: {
  iso: string;
  align: 'left' | 'right';
  variant: 'incoming' | 'outgoing';
}) {
  const t = formatMessageTime(iso);
  if (!t) return null;
  return (
    <p
      className={`mt-1 text-[11px] tabular-nums px-0.5 ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${variant === 'outgoing' ? 'text-white/55' : 'text-gray-400'}`}
    >
      {t}
    </p>
  );
}

function BerichtenInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatParam = searchParams.get('chat');

  const [list, setList] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(chatParam);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** Lokaal: meerdere bubbles vóór één server-roundtrip (debounce). */
  const [optimisticBatch, setOptimisticBatch] = useState<ChatMessage[]>([]);
  const [optimisticImageById, setOptimisticImageById] = useState<Record<string, string>>({});
  const outgoingAccumRef = useRef<
    Array<{
      text: string;
      image?: { base64: string; mime: string; previewUrl: string };
    }>
  >([]);
  const batchFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const BATCH_MS = 640;
  const [pendingImage, setPendingImage] = useState<{
    base64: string;
    mime: string;
    previewUrl: string;
  } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  /** Server gaat spraak-antwoord maken — toon mic-indicator i.p.v. alleen typ-stippen. */
  const [expectVoiceReply, setExpectVoiceReply] = useState(false);
  const [creditsBalance, setCreditsBalance] = useState(INITIAL_FREE_CREDITS);
  const { openPricing } = useCreditsPricing();
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  /** Welk gesprek de huidige niet-zachte fetch laadt (voorkomt vastlopende loading bij snel wisselen). */
  const loadingConversationIdRef = useRef<string | null>(null);
  /** Tot deze tijd (epoch ms) tonen we “Online” na jouw bericht / haar antwoord. */
  const [peerOnlineUntil, setPeerOnlineUntil] = useState<number | null>(null);
  const [arrivalToast, setArrivalToast] = useState<string | null>(null);
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const onlineDelayTimerRef = useRef<number | null>(null);
  const arrivalToastTimerRef = useRef<number | null>(null);
  const conversationProfileNameRef = useRef<string>('Ze');

  const fetchList = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingList(true);
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Laden mislukt');
      setList(data.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout bij laden inbox');
    } finally {
      if (!opts?.silent) setLoadingList(false);
    }
  }, []);

  const fetchConversation = useCallback(async (id: string, opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    if (!soft) {
      loadingConversationIdRef.current = id;
      setLoadingMessages(true);
    }
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gesprek niet gevonden');
      if (selectedIdRef.current !== id) return;
      setConversation(data.conversation);
    } catch (e) {
      if (selectedIdRef.current !== id) return;
      setError(e instanceof Error ? e.message : 'Fout');
    } finally {
      if (!soft && loadingConversationIdRef.current === id) {
        loadingConversationIdRef.current = null;
        setLoadingMessages(false);
      }
    }
  }, []);

  useEffect(() => {
    const sync = () => setCreditsBalance(getCreditsBalance());
    sync();
    window.addEventListener('dm-credits-updated', sync);
    return () => window.removeEventListener('dm-credits-updated', sync);
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const id = window.setInterval(() => setPresenceNow(Date.now()), 30_000);
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
    if (chatParam) setSelectedId(chatParam);
  }, [chatParam]);

  useEffect(() => {
    if (selectedId) {
      fetchConversation(selectedId);
    } else {
      setConversation(null);
      setLoadingMessages(false);
      loadingConversationIdRef.current = null;
    }
  }, [selectedId, fetchConversation]);

  useEffect(() => {
    if (conversation?.profileName) {
      conversationProfileNameRef.current = conversation.profileName;
    }
  }, [conversation?.profileName]);

  const lastServerMsgId =
    conversation && conversation.messages.length > 0
      ? conversation.messages[conversation.messages.length - 1]!.id
      : '';
  const lastOptimisticId =
    optimisticBatch.length > 0
      ? optimisticBatch[optimisticBatch.length - 1]!.id
      : '';

  useLayoutEffect(() => {
    if (!selectedId || loadingMessages) return;
    const el = chatScrollRef.current;
    if (!el) return;
    /** Alleen deze lijst scrollen — geen scrollIntoView (die schuift ook het hele document). */
    el.scrollTop = el.scrollHeight;
  }, [
    selectedId,
    loadingMessages,
    conversation?.messages.length,
    lastServerMsgId,
    lastOptimisticId,
    optimisticBatch.length,
    sending,
    expectVoiceReply,
  ]);

  useEffect(() => {
    outgoingAccumRef.current = [];
    if (batchFlushTimerRef.current) {
      clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = null;
    }
    setOptimisticBatch([]);
    setOptimisticImageById({});
  }, [selectedId]);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

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
      if (!m.voice) return;
      if (playingVoiceId === m.id) {
        stopVoicePlayback();
        return;
      }
      stopVoicePlayback();
      setPlayingVoiceId(m.id);
      try {
        const speak = m.voice.ttsText ?? m.content;
        const res = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: speak, language: m.voice.language }),
        });
        if (!res.ok) throw new Error('TTS mislukt');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => stopVoicePlayback();
        await audio.play();
      } catch {
        stopVoicePlayback();
      }
    },
    [playingVoiceId, stopVoicePlayback]
  );

  const filteredList = list.filter((c) => {
    const q = query.toLowerCase();
    return (
      (c.profileName ?? '').toLowerCase().includes(q) ||
      (c.lastMessage ?? '').toLowerCase().includes(q)
    );
  });

  const totalUnread = list.reduce((a, c) => a + c.unread, 0);

  const lastAssistantIso = conversation
    ? lastAssistantMessageAt(conversation.messages)
    : null;
  const assistantMsgCount = conversation
    ? conversation.messages.filter((m) => m.role === 'assistant').length
    : 0;
  const lastOnlineSubtitle =
    conversation && assistantMsgCount === 0
      ? `${syntheticLastSeenMinutes(conversation.id)} minuten geleden`
      : lastAssistantIso
        ? formatLastOnlineAgo(lastAssistantIso, presenceNow)
        : '—';
  const isPeerOnlineNow =
    sending ||
    optimisticBatch.length > 0 ||
    (peerOnlineUntil !== null && Date.now() < peerOnlineUntil);

  const clearBatchTimer = useCallback(() => {
    if (batchFlushTimerRef.current) {
      clearTimeout(batchFlushTimerRef.current);
      batchFlushTimerRef.current = null;
    }
  }, []);

  const flushOutgoingBatch = useCallback(async () => {
    clearBatchTimer();
    const batch = outgoingAccumRef.current;
    if (batch.length === 0) return;
    const sid = selectedIdRef.current;
    if (!sid) return;

    const cost = creditsCostForBatchSize(batch.length);
    const balance = getCreditsBalance();
    if (balance < cost) {
      outgoingAccumRef.current = [];
      setOptimisticBatch([]);
      setOptimisticImageById({});
      openPricing();
      return;
    }

    outgoingAccumRef.current = [];

    setSending(true);
    setError(null);

    const items = batch.map((b) => ({
      text: b.text,
      imageBase64: b.image?.base64,
      imageMime: b.image?.mime,
    }));

    const tier = intimacyTierFromCount(conversation?.messages.length ?? 0);
    const anyImg = items.some((i) => i.imageBase64);
    const joinedText = items.map((i) => i.text).join('\n');
    const trustVoice =
      items.some((it) => triggersTrustProofVoiceRequest(it.text || '')) ||
      triggersTrustProofVoiceRequest(joinedText);
    const flirtyVoice =
      items.some((it) =>
        triggersAssistantVoiceReply(it.text || 'foto', {
          intimacyTier: tier,
          hasImage: Boolean(it.imageBase64),
        })
      ) ||
      triggersAssistantVoiceReply(joinedText, {
        intimacyTier: tier,
        hasImage: anyImg,
      });
    setExpectVoiceReply(trustVoice || flirtyVoice);

    try {
      const res = await fetch(`/api/conversations/${sid}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Versturen mislukt');
      spendChatCredit(cost);
      setCreditsBalance(getCreditsBalance());
      setOptimisticBatch([]);
      setOptimisticImageById({});
      await fetchConversation(sid, { soft: true });
      await fetchList({ silent: true });

      const pname = conversationProfileNameRef.current;
      setArrivalToast(`${pname} heeft je een berichtje gestuurd`);
      if (arrivalToastTimerRef.current) {
        window.clearTimeout(arrivalToastTimerRef.current);
      }
      arrivalToastTimerRef.current = window.setTimeout(() => {
        arrivalToastTimerRef.current = null;
        setArrivalToast(null);
      }, 4800);
      setPeerOnlineUntil((prev) => {
        const extra = 40_000 + Math.floor(Math.random() * 110_000);
        const until = Date.now() + extra;
        return Math.max(prev ?? 0, until);
      });
    } catch (e) {
      setOptimisticBatch([]);
      setOptimisticImageById({});
      setError(e instanceof Error ? e.message : 'Fout bij versturen');
    } finally {
      setExpectVoiceReply(false);
      setSending(false);
    }
  }, [
    clearBatchTimer,
    conversation?.messages.length,
    fetchConversation,
    fetchList,
    openPricing,
  ]);

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
    if (!selectedId || sending) return;
    const trimmed = input.trim();
    if (!trimmed && !pendingImage) return;

    if (trimmed.length > MAX_USER_MESSAGE_CHARS) {
      setError(
        `Je bericht is langer dan ${MAX_USER_MESSAGE_CHARS} tekens. Maak het korter of stuur het in meerdere berichten.`
      );
      return;
    }
    if (outgoingAccumRef.current.length >= MAX_OUTGOING_BATCH_SIZE) {
      setError(
        `Je kunt maximaal ${MAX_OUTGOING_BATCH_SIZE} berichten tegelijk versturen. Wacht tot de vorige zijn verzonden.`
      );
      return;
    }

    const nextBatchLen = outgoingAccumRef.current.length + 1;
    const sendCost = creditsCostForBatchSize(nextBatchLen);
    if (getCreditsBalance() < sendCost) {
      openPricing();
      return;
    }

    setError(null);
    const sentImage = pendingImage;
    setInput('');
    setPendingImage(null);

    outgoingAccumRef.current.push({
      text: trimmed,
      image: sentImage ?? undefined,
    });

    const om: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: 'user',
      content: trimmed || '📷',
      createdAt: new Date().toISOString(),
      readByPeer: false,
    };
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

    if (sentImage) {
      void flushOutgoingBatch();
    } else {
      clearBatchTimer();
      batchFlushTimerRef.current = setTimeout(() => void flushOutgoingBatch(), BATCH_MS);
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

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--surface)] pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:h-auto md:min-h-screen md:overflow-visible md:pb-0 lg:h-dvh lg:overflow-hidden">
      <Navbar />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-12 sm:pt-14 md:pt-20 md:overflow-visible lg:min-h-0 lg:overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden lg:flex-row lg:overflow-hidden xl:px-2">
        {/* Inbox list */}
        <div
          className={`flex w-full flex-shrink-0 flex-col border-b border-gray-200/80 bg-[var(--surface-card)] lg:w-[340px] lg:min-h-0 lg:border-b-0 lg:border-r lg:max-h-full ${
            selectedId ? 'hidden lg:flex' : 'flex max-h-[42vh] min-h-0 lg:max-h-none'
          }`}
        >
          <div className="p-4 md:p-6 border-b border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-2xl text-gray-900">Berichten</h2>
              <div className="bg-primary text-white text-xs font-semibold px-2.5 py-1 rounded-full min-w-[28px] text-center">
                {totalUnread || list.length}
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-4 top-3.5 text-gray-400 w-4 h-4" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zoek in berichten..."
                className="w-full bg-gray-100 border-0 rounded-2xl pl-11 pr-4 py-3 text-sm focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto lg:min-h-0">
            {loadingList && (
              <p className="p-6 text-gray-500 text-sm">Laden…</p>
            )}
            {!loadingList &&
              filteredList.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => selectChat(chat.id)}
                  className={`w-full flex gap-3 px-4 md:px-6 py-4 text-left border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    selectedId === chat.id ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <img
                      src={chat.previewAvatar}
                      alt=""
                      className="w-12 h-12 rounded-2xl object-cover ring-2 ring-white shadow-sm"
                    />
                    {chat.isOnline && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full" />
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
                    <p className="text-sm text-gray-600 line-clamp-2 mt-0.5">
                      {chat.lastMessage}
                    </p>
                  </div>
                  {chat.unread > 0 && (
                    <span className="self-center shrink-0 bg-primary text-white text-[10px] font-bold min-w-[22px] h-[22px] px-1.5 flex items-center justify-center rounded-full">
                      {chat.unread}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>

        {/* Chat / empty */}
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-card)] ${
            !selectedId ? 'flex' : 'flex lg:flex'
          } ${selectedId ? '' : 'hidden lg:flex'}`}
        >
          {error && (
            <div className="mx-4 mt-4 shrink-0 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {selectedId && loadingMessages && (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              Gesprek laden…
            </div>
          )}

          {selectedId && !loadingMessages && conversation && (
            <>
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
                <div className="relative shrink-0">
                  <img
                    src={conversation.previewAvatar}
                    alt=""
                    className="h-11 w-11 rounded-2xl object-cover ring-2 ring-white shadow-sm"
                  />
                  {isPeerOnlineNow && (
                    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold text-[16px] text-gray-900">
                    {conversation.profileName}
                  </h2>
                  <p className="mt-0.5 truncate text-[12px] text-gray-500">
                    {isPeerOnlineNow ? (
                      <span className="font-medium text-emerald-600">Online</span>
                    ) : (
                      <>
                        Voor het laatst online ·{' '}
                        <span className="text-gray-600">{lastOnlineSubtitle}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div
                ref={chatScrollRef}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 space-y-4"
              >
                {conversation.messages.length === 0 && (
                  <p className="text-center text-gray-500 text-sm">
                    Stuur een bericht — het profiel antwoordt via AI (Grok).
                  </p>
                )}
                {[...conversation.messages, ...optimisticBatch].map((m: ChatMessage) => (
                    <div
                      key={m.id}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {m.role === 'assistant' && m.voice ? (
                        <div className="flex max-w-[88%] flex-col items-start space-y-2">
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
                          </button>
                          <MessageTimestamp
                            iso={m.createdAt}
                            align="left"
                            variant="incoming"
                          />
                        </div>
                      ) : m.role === 'user' ? (
                        (() => {
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
                                <div className="relative overflow-hidden rounded-2xl border border-primary/25 shadow-md">
                                  <img
                                    src={imgSrc}
                                    alt=""
                                    className="max-h-64 w-full object-cover bg-black/5"
                                  />
                                  {!textBody && (
                                    <div className="absolute bottom-2 right-2 rounded-full bg-black/45 p-1.5">
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
                                  <p className="whitespace-pre-wrap">{textBody}</p>
                                  <div className="mt-1.5 flex justify-end">
                                    {m.readByPeer === false ? (
                                      <Check
                                        className="h-4 w-4 text-white/55"
                                        strokeWidth={2.5}
                                        aria-label="Verzonden"
                                      />
                                    ) : (
                                      <CheckCheck
                                        className="h-4 w-4 text-red-100"
                                        strokeWidth={2.5}
                                        aria-label="Gelezen"
                                      />
                                    )}
                                  </div>
                                </div>
                              ) : null}
                              <MessageTimestamp
                                iso={m.createdAt}
                                align="right"
                                variant="outgoing"
                              />
                            </div>
                          );
                        })()
                      ) : (
                        <div className="flex max-w-[85%] flex-col items-start">
                          <div className="rounded-2xl rounded-bl-sm border border-gray-200/60 bg-[var(--surface-card)] px-4 py-3 text-[15px] leading-snug text-gray-900 shadow-md shadow-black/10">
                            <p className="whitespace-pre-wrap">{m.content}</p>
                          </div>
                          <MessageTimestamp
                            iso={m.createdAt}
                            align="left"
                            variant="incoming"
                          />
                        </div>
                      )}
                    </div>
                  )
                )}
                {sending && expectVoiceReply && (
                  <div className="flex justify-start">
                    <div className="flex max-w-[92%] items-center gap-3 rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-3 text-[14px] text-gray-700 shadow-md shadow-black/10">
                      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Mic className="relative z-10 h-5 w-5 voice-mic-breathe" aria-hidden />
                        <span
                          className="absolute inset-0 rounded-full border-2 border-primary/30 voice-mic-ring"
                          aria-hidden
                        />
                      </span>
                      <p className="leading-snug">
                        <span className="font-semibold text-gray-900">{conversation.profileName}</span>
                        <span className="text-gray-600"> spreekt een spraakbericht in…</span>
                      </p>
                    </div>
                  </div>
                )}
                {sending && !expectVoiceReply && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm border border-gray-200/50 bg-gray-100 px-4 py-3 text-gray-600 shadow-md shadow-black/10">
                      <span className="sr-only">{conversation.profileName} typt…</span>
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

              <div className="shrink-0 border-t border-gray-200/70 bg-[var(--surface-card)] p-4 pb-safe">
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
                <div className="flex gap-2 max-w-3xl mx-auto items-stretch sm:items-center">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => imageInputRef.current?.click()}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-primary shadow-sm hover:bg-primary/5 disabled:opacity-50"
                    title="Foto (JPG/PNG)"
                    aria-label="Foto toevoegen"
                  >
                    <ImagePlus className="h-5 w-5" />
                  </button>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Typ je bericht…"
                    className="flex-1 min-w-0 rounded-2xl border border-gray-200 px-4 py-3 text-[15px] focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  <Button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || (!input.trim() && !pendingImage)}
                    className="rounded-2xl px-6"
                  >
                    {sending ? '…' : 'Verstuur'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {!selectedId && !loadingList && list.length === 0 && <EmptyState />}
          {!selectedId && !loadingList && list.length > 0 && (
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
    <div className="hidden xl:block w-[300px] border-l border-gray-200/80 bg-[var(--surface-card)] p-6 flex-shrink-0">
      <div className="bg-gradient-to-br from-primary to-primary-deep text-white rounded-3xl p-6 shadow-xl">
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="uppercase tracking-wider text-[10px] opacity-80">PREMIUM</div>
            <div className="text-2xl font-bold mt-1 leading-tight">
              Krijg meer met Credits
            </div>
            <p className="text-xs opacity-85 mt-2 leading-snug">
              {CREDITS_PER_MESSAGE} credits per bericht · eerste {INITIAL_FREE_CREDITS} gratis
            </p>
          </div>
          <CreditCard className="w-8 h-8 opacity-80" />
        </div>
        <ul className="space-y-3 text-sm border-t border-white/20 pt-4">
          <li className="flex flex-col gap-0.5 font-semibold">
            <span className="flex justify-between gap-2">
              <span>Aanbevolen</span>
              <span className="text-amber-200 text-[10px] font-bold uppercase">
                −{FEATURED_DEAL_DISCOUNT_PERCENT}%
              </span>
            </span>
            <span className="opacity-95 text-sm font-normal">
              <span className="line-through opacity-70 mr-1.5">{FEATURED_DEAL_WAS_PRICE_LABEL}</span>
              {FEATURED_DEAL_PRICE_LABEL} · {FEATURED_DEAL_CREDITS.toLocaleString('nl-NL')}
            </span>
          </li>
          <li className="flex justify-between gap-2 opacity-75 text-xs">
            <span>Express</span>
            <span>€59,99 · 800 · veel duurder</span>
          </li>
          <li className="flex justify-between gap-2 opacity-75 text-xs">
            <span>Express plus</span>
            <span>€44,99 · 500</span>
          </li>
        </ul>
        <ul className="space-y-4 text-sm mt-4">
          <li className="flex gap-3">
            <span className="text-lg">🚀</span> Profiel boost
          </li>
          <li className="flex gap-3">
            <span className="text-lg">💬</span> Onbeperkt chatten
          </li>
          <li className="flex gap-3">
            <span className="text-lg">⭐</span> Top in zoekresultaten
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
          {balance < CREDITS_PER_MESSAGE ? (
            <span className="font-semibold">
              Te weinig credits voor een bericht — open prijzen om bij te kopen.
            </span>
          ) : (
            <>Je hebt nog {balance} credits</>
          )}
        </p>
      </div>
    </div>
  );
}
