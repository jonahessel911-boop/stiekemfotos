'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '@/components/admin/admin-utils';
import { countOpenChats } from '@/lib/admin/chat-open';
import type { AdminChatMessage, AdminConversation, AdminUserConversations } from '@/lib/admin/types';

type ChatsPayload = {
  conversationsByUser: AdminUserConversations[];
  openChats: number;
};

const LIST_POLL_MS = 3_000;
const THREAD_POLL_MS = 2_000;

function patchUserConv(
  users: AdminUserConversations[],
  convId: string,
  patch: (c: AdminConversation) => AdminConversation
): AdminUserConversations[] {
  return users.map((u) => ({
    ...u,
    conversations: u.conversations.map((c) => (c.id === convId ? patch(c) : c)),
  }));
}

/** Behoud optimistische admin-berichten tijdens poll terwijl POST nog loopt. */
function mergeThreadMessages(
  server: AdminChatMessage[],
  local: AdminChatMessage[]
): AdminChatMessage[] {
  const serverIds = new Set(server.map((m) => m.id));
  const pending = local.filter(
    (m) => m.id.startsWith('opt-admin-') && !serverIds.has(m.id)
  );
  if (pending.length === 0) return server;
  return [...server, ...pending].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export default function AdminChats() {
  const [chats, setChats] = useState<ChatsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [userQuery, setUserQuery] = useState('');
  const [convQuery, setConvQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendGuardRef = useRef(false);
  const listPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const threadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const threadLenRef = useRef(0);
  const effectiveConvIdRef = useRef<string | null>(null);

  const loadChats = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setListLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/chats', { credentials: 'include', cache: 'no-store' });
      const body = (await res.json()) as ChatsPayload & { error?: string };
      if (!res.ok) throw new Error(body.error || 'Chats laden mislukt');
      const conversationsByUser = body.conversationsByUser ?? [];
      setChats((prev) => {
        if (!prev || !opts?.silent) {
          return {
            conversationsByUser,
            openChats: body.openChats ?? 0,
          };
        }
        const activeId = effectiveConvIdRef.current;
        if (!activeId) {
          return {
            conversationsByUser,
            openChats: body.openChats ?? 0,
          };
        }
        const localConv = prev.conversationsByUser
          .flatMap((u) => u.conversations)
          .find((c) => c.id === activeId);
        if (!localConv) {
          return {
            conversationsByUser,
            openChats: body.openChats ?? 0,
          };
        }
        return {
          conversationsByUser: patchUserConv(conversationsByUser, activeId, (c) => ({
            ...c,
            history: mergeThreadMessages(
              c.history,
              localConv.history
            ),
            messages: mergeThreadMessages(c.history, localConv.history).length,
          })),
          openChats: body.openChats ?? 0,
        };
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('admin-open-chats', {
            detail: { openChats: body.openChats ?? 0 },
          })
        );
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Fout');
    } finally {
      if (!opts?.silent) setListLoading(false);
    }
  }, []);

  const users = useMemo(() => {
    let list = chats?.conversationsByUser ?? [];
    const q = userQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) =>
          u.userName.toLowerCase().includes(q) ||
          u.userEmail.toLowerCase().includes(q) ||
          u.userId.toLowerCase().includes(q)
      );
    }
    return list;
  }, [chats?.conversationsByUser, userQuery]);

  const effectiveUserId = selectedUserId ?? users[0]?.userId ?? null;
  const selectedUser = users.find((u) => u.userId === effectiveUserId) ?? null;

  const conversations = useMemo(() => {
    let list = selectedUser?.conversations ?? [];
    const q = convQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.profileName.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
      );
    }
    return list;
  }, [selectedUser, convQuery]);

  const effectiveConvId = selectedConvId ?? conversations[0]?.id ?? null;
  const selectedConv = conversations.find((c) => c.id === effectiveConvId) ?? null;
  const threadMessages: AdminChatMessage[] = selectedConv?.history ?? [];

  useEffect(() => {
    effectiveConvIdRef.current = effectiveConvId;
  }, [effectiveConvId]);

  const refreshThread = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/admin/conversations/${convId}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = (await res.json()) as {
        conversation?: {
          id: string;
          messages: AdminChatMessage[];
          updatedAt: string;
        };
        error?: string;
      };
      if (!res.ok || !body.conversation) return;
      const serverMsgs = body.conversation.messages;
      let mergedLen = serverMsgs.length;
      setChats((prev) => {
        if (!prev) return prev;
        const conversationsByUser = patchUserConv(prev.conversationsByUser, convId, (c) => {
          const history = mergeThreadMessages(serverMsgs, c.history);
          mergedLen = history.length;
          const last = history[history.length - 1];
          return {
            ...c,
            history,
            messages: history.length,
            lastMessage: last?.content?.slice(0, 240) ?? c.lastMessage,
            updatedAt: body.conversation!.updatedAt,
          };
        });
        return {
          ...prev,
          conversationsByUser,
          openChats: countOpenChats(conversationsByUser),
        };
      });
      if (effectiveConvIdRef.current === convId && mergedLen > threadLenRef.current) {
        threadLenRef.current = mergedLen;
        queueMicrotask(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        });
      } else if (effectiveConvIdRef.current === convId) {
        threadLenRef.current = mergedLen;
      }
    } catch {
      /* stille poll */
    }
  }, []);

  useEffect(() => {
    void loadChats();
    if (listPollRef.current) clearInterval(listPollRef.current);
    listPollRef.current = setInterval(() => {
      void loadChats({ silent: true });
    }, LIST_POLL_MS);

    const onFocus = () => {
      void loadChats({ silent: true });
      const id = effectiveConvIdRef.current;
      if (id) void refreshThread(id);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (listPollRef.current) clearInterval(listPollRef.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadChats, refreshThread]);

  useEffect(() => {
    if (threadPollRef.current) clearInterval(threadPollRef.current);
    if (!effectiveConvId) return;
    threadLenRef.current = threadMessages.length;
    void refreshThread(effectiveConvId);
    threadPollRef.current = setInterval(() => {
      void refreshThread(effectiveConvId);
    }, THREAD_POLL_MS);
    return () => {
      if (threadPollRef.current) clearInterval(threadPollRef.current);
    };
  }, [effectiveConvId, refreshThread]);

  useEffect(() => {
    if (threadMessages.length > threadLenRef.current) {
      threadLenRef.current = threadMessages.length;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [threadMessages.length, effectiveConvId]);

  const appendMessage = useCallback((convId: string, message: AdminChatMessage) => {
    setChats((prev) => {
      if (!prev) return prev;
      const conversationsByUser = patchUserConv(prev.conversationsByUser, convId, (c) => ({
        ...c,
        history: [...c.history, message],
        messages: c.messages + 1,
        lastMessage: message.content.slice(0, 240),
        updatedAt: message.createdAt,
      }));
      return {
        ...prev,
        conversationsByUser,
        openChats: countOpenChats(conversationsByUser),
      };
    });
  }, []);

  const reconcileMessage = useCallback(
    (convId: string, tempId: string, message: AdminChatMessage | null) => {
      setChats((prev) => {
        if (!prev) return prev;
        const conversationsByUser = patchUserConv(prev.conversationsByUser, convId, (c) => {
          const history = message
            ? c.history.map((m) => (m.id === tempId ? message : m))
            : c.history.filter((m) => m.id !== tempId);
          const last = history[history.length - 1];
          return {
            ...c,
            history,
            messages: message ? c.messages : Math.max(0, c.messages - 1),
            lastMessage: last?.content.slice(0, 240) ?? c.lastMessage,
            updatedAt: last?.createdAt ?? c.updatedAt,
          };
        });
        return {
          ...prev,
          conversationsByUser,
          openChats: countOpenChats(conversationsByUser),
        };
      });
    },
    []
  );

  const pickUser = (userId: string) => {
    setSelectedUserId(userId);
    setSelectedConvId(null);
    setConvQuery('');
    setSendError(null);
  };

  const pickConv = (convId: string) => {
    setSelectedConvId(convId);
    setSendError(null);
    void refreshThread(convId);
  };

  const sendAsProfile = () => {
    const text = draft.trim();
    if (!effectiveConvId || !text || sendGuardRef.current) return;

    const tempId = `opt-admin-${Date.now()}`;
    const optimistic: AdminChatMessage = {
      id: tempId,
      role: 'assistant',
      content: text,
      createdAt: new Date().toISOString(),
    };

    appendMessage(effectiveConvId, optimistic);
    setDraft('');
    setSendError(null);
    sendGuardRef.current = true;

    void (async () => {
      try {
        const res = await fetch(`/api/admin/conversations/${effectiveConvId}/messages`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });
        const body = (await res.json()) as {
          error?: string;
          message?: AdminChatMessage;
        };
        if (!res.ok) throw new Error(body.error || 'Versturen mislukt');
        reconcileMessage(
          effectiveConvId,
          tempId,
          body.message ?? optimistic
        );
      } catch (e) {
        reconcileMessage(effectiveConvId, tempId, null);
        setSendError(e instanceof Error ? e.message : 'Versturen mislukt');
      } finally {
        sendGuardRef.current = false;
      }
    })();
  };

  const openChats = chats?.openChats ?? 0;

  if (listLoading && !chats) {
    return <p className="admin-chats-empty">Laden…</p>;
  }

  return (
    <>
      <div className="admin-panel" style={{ marginBottom: 12 }}>
        <div className="admin-panel-head">
          Chats — handmatig beantwoorden
          <small>{openChats} open · AI uit</small>
        </div>
      </div>

      {loadError ? <div className="admin-alert admin-alert-error">{loadError}</div> : null}

      <div className="admin-chats">
        <div className="admin-chats-col">
          <div className="admin-chats-col-head">Users ({users.length})</div>
          <div className="admin-chats-search">
            <input
              className="admin-input"
              placeholder="Zoek user…"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
          </div>
          <ul className="admin-chats-list">
            {users.length === 0 ? (
              <li className="admin-chats-empty">Geen gesprekken</li>
            ) : (
              users.map((u) => (
                <li key={u.userId}>
                  <button
                    type="button"
                    className={effectiveUserId === u.userId ? 'is-active' : ''}
                    onClick={() => pickUser(u.userId)}
                  >
                    <strong>{u.userName}</strong>
                    <span className="sub">{u.userEmail}</span>
                    <span className="sub">{u.conversations.length} gesprekken</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="admin-chats-col">
          <div className="admin-chats-col-head">
            Gesprekken
            {selectedUser ? <small> — {selectedUser.userName}</small> : null}
          </div>
          <div className="admin-chats-search">
            <input
              className="admin-input"
              placeholder="Zoek gesprek…"
              value={convQuery}
              onChange={(e) => setConvQuery(e.target.value)}
              disabled={!selectedUser}
            />
          </div>
          <ul className="admin-chats-list">
            {!selectedUser ? (
              <li className="admin-chats-empty">Kies een user</li>
            ) : conversations.length === 0 ? (
              <li className="admin-chats-empty">Geen gesprekken</li>
            ) : (
              conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={effectiveConvId === c.id ? 'is-active' : ''}
                    onClick={() => pickConv(c.id)}
                  >
                    <strong>{c.profileName}</strong>
                    <span className="sub">
                      {c.messages} berichten · {fmt(c.updatedAt)}
                    </span>
                    <span className="sub">{c.lastMessage || '—'}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="admin-chats-col admin-chats-col--thread">
          <div className="admin-chats-col-head">
            {selectedConv ? (
              <>
                Antwoord als <strong>{selectedConv.profileName}</strong>
              </>
            ) : (
              'Berichten'
            )}
          </div>
          <div className="admin-chats-messages">
            {!selectedConv ? (
              <p className="admin-chats-empty">Kies een gesprek</p>
            ) : threadMessages.length === 0 ? (
              <p className="admin-chats-empty">Geen berichten</p>
            ) : (
              threadMessages.map((m) => (
                <div
                  key={m.id}
                  className={`admin-chat-bubble ${
                    m.role === 'user' ? 'admin-chat-bubble-user' : 'admin-chat-bubble-assistant'
                  }`}
                >
                  <div className="admin-chat-bubble-meta">
                    <span>{m.role === 'user' ? 'User' : selectedConv.profileName}</span>
                    <span>{fmt(m.createdAt)}</span>
                  </div>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {m.content || '…'}
                  </p>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          {selectedConv ? (
            <form
              className="admin-chats-compose"
              onSubmit={(e) => {
                e.preventDefault();
                sendAsProfile();
              }}
            >
              {sendError ? <div className="admin-alert admin-alert-error">{sendError}</div> : null}
              <textarea
                className="admin-textarea"
                rows={3}
                placeholder={`Typ als ${selectedConv.profileName}…`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendAsProfile();
                  }
                }}
              />
              <button
                type="submit"
                className="admin-btn admin-btn-primary"
                disabled={!draft.trim()}
              >
                Verstuur als profiel
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </>
  );
}
