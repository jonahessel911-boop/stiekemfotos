'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin } from '@/components/admin/AdminProvider';
import { fmt } from '@/components/admin/admin-utils';
import {
  isConversationAwaitingReply,
  openChatsForUser,
} from '@/lib/admin/chat-open';
import type { AdminChatMessage } from '@/lib/admin/types';

export default function AdminChats() {
  const { data, loading, appendAdminConversationMessage, reconcileAdminConversationMessage } =
    useAdmin();
  const [userQuery, setUserQuery] = useState('');
  const [convQuery, setConvQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendGuardRef = useRef(false);

  const openChats = data?.stats.openChats ?? 0;

  const users = useMemo(() => {
    let list = data?.conversationsByUser ?? [];
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
  }, [data?.conversationsByUser, userQuery]);

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
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [selectedUser, convQuery]);

  const effectiveConvId = selectedConvId ?? conversations[0]?.id ?? null;
  const selectedConv = conversations.find((c) => c.id === effectiveConvId) ?? null;
  const threadMessages: AdminChatMessage[] = selectedConv?.history ?? [];
  const awaitingReply = selectedConv ? isConversationAwaitingReply(threadMessages) : false;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages.length, effectiveConvId]);

  const pickUser = (userId: string) => {
    setSelectedUserId(userId);
    setSelectedConvId(null);
    setConvQuery('');
    setSendError(null);
  };

  const pickConv = (convId: string) => {
    setSelectedConvId(convId);
    setSendError(null);
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

    appendAdminConversationMessage(effectiveConvId, optimistic);
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
        if (body.message) {
          reconcileAdminConversationMessage(effectiveConvId, tempId, body.message);
        } else {
          reconcileAdminConversationMessage(effectiveConvId, tempId, optimistic);
        }
      } catch (e) {
        reconcileAdminConversationMessage(effectiveConvId, tempId, null);
        setSendError(e instanceof Error ? e.message : 'Versturen mislukt');
      } finally {
        sendGuardRef.current = false;
      }
    })();
  };

  if (loading && !data) {
    return <p className="admin-chats-empty">Laden…</p>;
  }

  return (
    <>
      <div className="admin-panel" style={{ marginBottom: 12 }}>
        <div className="admin-panel-head">
          Chats — handmatig beantwoorden
          <small>
            {openChats} open · AI uit — antwoord als profiel hieronder
          </small>
        </div>
      </div>

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
              <li className="admin-chats-empty">Geen users</li>
            ) : (
              users.map((u) => {
                const open = openChatsForUser(u);
                return (
                  <li key={u.userId}>
                    <button
                      type="button"
                      className={effectiveUserId === u.userId ? 'is-active' : ''}
                      onClick={() => pickUser(u.userId)}
                    >
                      <strong>
                        {u.userName}
                        {open > 0 ? <span className="admin-chat-open-dot"> {open}</span> : null}
                      </strong>
                      <span className="sub">{u.userEmail}</span>
                      <span className="sub">
                        {open > 0 ? `${open} open · ` : ''}
                        {u.conversations.length} gesprekken
                      </span>
                    </button>
                  </li>
                );
              })
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
              conversations.map((c) => {
                const open = isConversationAwaitingReply(c.history);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={effectiveConvId === c.id ? 'is-active' : ''}
                      onClick={() => pickConv(c.id)}
                    >
                      <strong>
                        {c.profileName}
                        {open ? <span className="admin-chat-open-tag"> OPEN</span> : null}
                      </strong>
                      <span className="sub">
                        {c.messages} berichten · {fmt(c.updatedAt)}
                      </span>
                      <span className="sub">{c.lastMessage || '—'}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="admin-chats-col admin-chats-col--thread">
          <div className="admin-chats-col-head">
            {selectedConv ? (
              <>
                Antwoord als <strong>{selectedConv.profileName}</strong>
                {awaitingReply ? (
                  <span className="admin-chat-open-tag"> · wacht op antwoord</span>
                ) : null}
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
                void sendAsProfile();
              }}
            >
              {sendError ? <div className="admin-alert admin-alert-error">{sendError}</div> : null}
              <textarea
                className="admin-textarea"
                rows={3}
                placeholder={`Typ als ${selectedConv.profileName}…`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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
