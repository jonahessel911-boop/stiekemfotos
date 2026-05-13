import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, ChatMessage } from "@/lib/types/chat";
import { sortChatMessagesChronologically } from "@/lib/chat-message-order";
import { resolveUserIdForSupabaseFk } from "@/lib/server/ensureUserRowForFk";

type ConversationRow = {
  id: string;
  owner_user_id: string | null;
  profile_id: string;
  profile_name: string;
  profile_avatar: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  metadata: unknown;
};

function stripMessagesFromMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const { messages: _m, ...rest } = meta;
  return rest;
}

function extractConversationMetadata(c: Conversation): Record<string, unknown> {
  const {
    id: _id,
    profileId: _pid,
    profileName: _pn,
    previewAvatar: _pa,
    messages,
    updatedAt: _ua,
    ownerUserId: _ou,
    threadCreatedAt: _tc,
    ...rest
  } = c;
  void messages;
  return stripMessagesFromMeta(rest as Record<string, unknown>);
}

function conversationFromRow(row: ConversationRow, messages: ChatMessage[]): Conversation {
  const metaRaw =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const cleaned = stripMessagesFromMeta(metaRaw);
  const sorted = sortChatMessagesChronologically(messages);
  const base = cleaned as Partial<Conversation>;
  return {
    ...base,
    id: row.id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    previewAvatar: row.profile_avatar ?? "",
    isOnline: Boolean(base.isOnline),
    messages: sorted,
    updatedAt: row.updated_at,
    threadCreatedAt: row.created_at,
    ownerUserId: row.owner_user_id ?? undefined,
  } as Conversation;
}

function messageFromRow(row: MessageRow): ChatMessage {
  const meta = row.metadata as { chatMessage?: ChatMessage } | null | undefined;
  const cm = meta?.chatMessage;
  if (cm && typeof cm === "object") {
    /** Postgres `messages.id` is bron van waarheid; nested kan verouderd zijn na migraties/edits. */
    if (cm.id === row.id) return cm;
    return { ...cm, id: row.id };
  }
  const role = row.role === "user" ? "user" : "assistant";
  return {
    id: row.id,
    role,
    content: row.content ?? "",
    createdAt: row.created_at,
  };
}

/** Voorkomt dat één INSERT meerdere keren dezelfde pkey raakt (Postgres fout 23505). */
function dedupeMessageInsertRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    byId.set(id, row);
  }
  return [...byId.values()];
}

function messageToInsertRow(m: ChatMessage, conversationId: string): Record<string, unknown> {
  const role =
    m.role === "user" || m.role === "assistant" ? m.role : ("assistant" as const);
  const gift = m.gift;
  return {
    id: m.id,
    conversation_id: conversationId,
    role,
    content: m.content ?? "",
    created_at: m.createdAt,
    /**
     * Voorkeur: persistent publieke URL (Supabase Storage).
     * Fallback: `local:${filename}` voor legacy data/dev. `imageFile` blijft
     * óók in de metadata-blob staan zodat de chat client beide kan vinden.
     */
    image_url: m.imageUrl?.trim()
      ? m.imageUrl.trim()
      : m.imageFile
        ? `local:${m.imageFile}`
        : null,
    voice_url: null,
    gift_credits: gift?.credits ?? null,
    gift_label: gift?.packageLabel ?? null,
    gift_note: gift?.note ?? null,
    metadata: { chatMessage: m },
  };
}

const MESSAGE_INSERT_CHUNK = 250;

export async function loadConversationsRelational(
  supabase: SupabaseClient
): Promise<Conversation[]> {
  const { data: convRows, error: ce } = await supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });
  if (ce) {
    throw new Error(`[conversationsRelational] load conversations: ${ce.message}`);
  }
  const rows = (convRows ?? []) as ConversationRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const byConv = new Map<string, ChatMessage[]>();

  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const { data: msgRows, error: me } = await supabase
      .from("messages")
      .select("*")
      .in("conversation_id", slice)
      .order("created_at", { ascending: true });
    if (me) {
      throw new Error(`[conversationsRelational] load messages: ${me.message}`);
    }
    for (const raw of msgRows ?? []) {
      const row = raw as MessageRow;
      const msg = messageFromRow(row);
      const arr = byConv.get(row.conversation_id) ?? [];
      arr.push(msg);
      byConv.set(row.conversation_id, arr);
    }
  }

  return rows.map((r) => conversationFromRow(r, byConv.get(r.id) ?? []));
}

/**
 * Hot path: gericht zoeken naar een bestaande conversation voor één owner+profiel.
 * Vermijdt loadConversationsRelational (die ALLE conversations van ALLE users laadt
 * met alle berichten — traag bij groeiende dataset).
 */
export async function loadConversationByOwnerAndProfile(
  supabase: SupabaseClient,
  ownerFk: string,
  profileId: string
): Promise<Conversation | null> {
  const { data: rows, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("owner_user_id", ownerFk)
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(
      `[conversationsRelational] load conv by owner+profile: ${error.message}`
    );
  }
  const row = (rows ?? [])[0] as ConversationRow | undefined;
  if (!row) return null;
  const { data: msgRows, error: me } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", row.id)
    .order("created_at", { ascending: true });
  if (me) {
    throw new Error(
      `[conversationsRelational] load messages ${row.id}: ${me.message}`
    );
  }
  const messages = (msgRows ?? []).map((raw) => messageFromRow(raw as MessageRow));
  return conversationFromRow(row, messages);
}

export async function loadConversationById(
  supabase: SupabaseClient,
  conversationId: string
): Promise<Conversation | null> {
  const { data: row, error: ce } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (ce) {
    throw new Error(`[conversationsRelational] load conversation ${conversationId}: ${ce.message}`);
  }
  if (!row) return null;
  const convRow = row as ConversationRow;
  const { data: msgRows, error: me } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (me) {
    throw new Error(`[conversationsRelational] load messages ${conversationId}: ${me.message}`);
  }
  const messages = (msgRows ?? []).map((raw) => messageFromRow(raw as MessageRow));
  return conversationFromRow(convRow, messages);
}

async function upsertConversationAndMessages(
  supabase: SupabaseClient,
  c: Conversation,
  ownerFkCache: Map<string, string | null>
): Promise<void> {
  const rawOwner = c.ownerUserId?.trim();
  let ownerFk: string | null = null;
  if (rawOwner) {
    if (ownerFkCache.has(rawOwner)) {
      ownerFk = ownerFkCache.get(rawOwner)!;
    } else {
      ownerFk = await resolveUserIdForSupabaseFk(rawOwner);
      ownerFkCache.set(rawOwner, ownerFk);
    }
  }
  if (c.ownerUserId?.trim() && !ownerFk) {
    throw new Error(
      `[conversationsRelational] owner ${c.ownerUserId} kan niet naar Postgres voor gesprek ${c.id}`
    );
  }
  const { error: ue } = await supabase.from("conversations").upsert(
    {
      id: c.id,
      owner_user_id: ownerFk,
      profile_id: c.profileId,
      profile_name: c.profileName,
      profile_avatar: c.previewAvatar || null,
      updated_at: c.updatedAt,
      metadata: extractConversationMetadata(c),
    },
    { onConflict: "id" }
  );
  if (ue) {
    throw new Error(`[conversationsRelational] upsert conversation ${c.id}: ${ue.message}`);
  }

  /**
   * SAFETY: Als de in-memory state 0 messages bevat, NOOIT alle messages wipen.
   * Dat was de oorzaak van "Foto niet gevonden": een stale snapshot (race tussen
   * loadList → saveList en een concurrente POST messages flow) had c.messages = []
   * terwijl de DB net nieuwe berichten bevatte. De DELETE wiste die volledig.
   *
   * Als de in-memory state echt leeg is en de DB ook leeg, prima — geen DELETE nodig.
   * Als de DB al messages bevat, bail out met een warning.
   */
  if (c.messages.length === 0) {
    const { count: existingCount, error: ce2 } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id);
    if (ce2) {
      throw new Error(`[conversationsRelational] count messages ${c.id}: ${ce2.message}`);
    }
    if ((existingCount ?? 0) > 0) {
      console.warn(
        `[conversationsRelational] REFUSING to wipe ${existingCount} messages for conv ${c.id} — in-memory state is empty (likely stale snapshot). Conversation row updated; messages untouched.`
      );
      return;
    }
    /** Echt lege conv (net gemaakt) — niets te doen. */
    return;
  }

  /**
   * UPSERT-only flow (geen DELETE meer). Sinds messages in deze app alleen worden
   * toegevoegd of geüpdatet (replyToId, unlockedAt, imageFile, ...), en nooit hard
   * verwijderd, is een DELETE-vooraf onnodig. Hij introduceerde juist een race window:
   * als de DELETE slaagde maar de INSERT faalde (timeout, crash, stale state), bleef
   * de conv leeg achter. Nu doen we alleen UPSERT — bestaande rows worden geüpdatet
   * via onConflict=id, nieuwe rows worden ingevoegd. Geen data loss meer.
   */
  const inserts = dedupeMessageInsertRows(c.messages.map((m) => messageToInsertRow(m, c.id)));
  for (let i = 0; i < inserts.length; i += MESSAGE_INSERT_CHUNK) {
    const chunk = dedupeMessageInsertRows(inserts.slice(i, i + MESSAGE_INSERT_CHUNK));
    if (chunk.length === 0) continue;
    const { error: ie } = await supabase.from("messages").upsert(chunk, {
      onConflict: "id",
    });
    if (ie) {
      throw new Error(`[conversationsRelational] upsert messages ${c.id}: ${ie.message}`);
    }
  }
}

/** Alleen dit gesprek — voor chat hot path (geen volledige inbox-load + geen andere threads herschrijven). */
export async function saveSingleConversationRelational(
  supabase: SupabaseClient,
  c: Conversation
): Promise<void> {
  const ownerFkCache = new Map<string, string | null>();
  await upsertConversationAndMessages(supabase, c, ownerFkCache);
}

export async function saveConversationsRelational(
  supabase: SupabaseClient,
  list: Conversation[],
  opts?: {
    /** Optionele per-conv mutex zodat parallelle upsert+delete-message flows niet over elkaar heen schrijven. */
    withConversationLock?: <T>(conversationId: string, fn: () => Promise<T>) => Promise<T>;
    /**
     * Standaard UIT. Alleen aanzetten voor expliciete legacy-cleanup paden
     * (bv. purgeLegacySeedConversations). Bij elke normale saveList NIET aanzetten —
     * anders kan een stale snapshot (race tussen twee parallelle loadList→saveList
     * calls) een net-toegevoegde conversation in een andere flow per ongeluk
     * orphan-deleten, met als gevolg dataverlies en "Foto niet gevonden".
     */
    deleteOrphans?: boolean;
  }
): Promise<void> {
  if (opts?.deleteOrphans) {
    const keepIds = new Set(list.map((c) => c.id));
    const { data: existing } = await supabase.from("conversations").select("id");
    for (const r of existing ?? []) {
      const id = (r as { id: string }).id;
      if (!keepIds.has(id)) {
        const { error } = await supabase.from("conversations").delete().eq("id", id);
        if (error) console.error("[conversationsRelational] delete orphan conversation:", error.message);
      }
    }
  }

  const ownerFkCache = new Map<string, string | null>();
  const lock = opts?.withConversationLock;

  for (const c of list) {
    if (lock) {
      await lock(c.id, () => upsertConversationAndMessages(supabase, c, ownerFkCache));
    } else {
      await upsertConversationAndMessages(supabase, c, ownerFkCache);
    }
  }
}
