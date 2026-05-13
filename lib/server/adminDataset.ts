import type { Conversation, ChatMessage } from "@/lib/types/chat";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { readJsonBlob } from "@/lib/server/blobJson";
import { readJson } from "@/lib/server/store";
import { sortChatMessagesChronologically } from "@/lib/chat-message-order";

export type AdminUserRow = {
  id: string;
  email: string;
  naam: string;
  leeftijd: number;
  createdAt: string;
  emailVerifiedAt?: string;
  emailVerifyToken?: string;
  /** Wordt door `touchUserSeen` gezet bij elk app-bezoek na signup; gebruikt voor re-sign %. */
  lastSeenAt?: string;
};

export type AdminSignupRow = {
  naam: string;
  email: string;
  leeftijd: number;
  createdAt: string;
};

export type AdminStripeCheckoutRow = {
  sessionId: string;
  userId: string;
  credits: number;
  priceLabel: string;
  priceEurCents?: number;
  paidAt?: string;
  fulfilledAt?: string;
};

export type AdminDataset = {
  users: AdminUserRow[];
  signups: AdminSignupRow[];
  conversations: Conversation[];
  checkouts: AdminStripeCheckoutRow[];
  /** Bron die uiteindelijk gebruikt is — handig in logging/debug. */
  source: {
    users: "supabase" | "blob";
    signups: "supabase" | "local-json" | "blob";
    conversations: "supabase" | "blob";
    checkouts: "supabase" | "blob";
  };
};

type ConvRow = {
  id: string;
  owner_user_id: string | null;
  profile_id: string;
  profile_name: string;
  profile_avatar: string | null;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

type MsgRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  image_url: string | null;
  created_at: string;
  metadata: unknown;
};

function stripMessagesFromMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const { messages: _m, ...rest } = meta;
  void _m;
  return rest;
}

function conversationFromRow(row: ConvRow, messages: ChatMessage[]): Conversation {
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
    ownerUserId: row.owner_user_id ?? undefined,
  } as Conversation;
}

function messageFromRow(row: MsgRow): ChatMessage {
  const meta = row.metadata as { chatMessage?: ChatMessage } | null | undefined;
  const cm = meta?.chatMessage;
  if (cm && typeof cm === "object") {
    const merged: ChatMessage = cm.id === row.id ? cm : { ...cm, id: row.id };
    // Zorg dat `imageUrl` uit de kolom altijd meegenomen wordt (kan na migratie nieuwer zijn).
    if (row.image_url && !merged.imageUrl) {
      merged.imageUrl = row.image_url;
    }
    return merged;
  }
  const role: ChatMessage["role"] = row.role === "user" ? "user" : "assistant";
  return {
    id: row.id,
    role,
    content: row.content ?? "",
    createdAt: row.created_at,
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
  };
}

/** Eenvoudig parsen van het Dutch-style "€19,99" label naar centen. */
function parsePriceLabelToCents(label: string | null | undefined): number {
  if (!label) return 0;
  const s = String(label).trim();
  const m = s.match(/€?\s*([\d]{1,5})[.,](\d{2})/);
  if (m) {
    const euro = parseInt(m[1] ?? "0", 10);
    const cents = parseInt(m[2] ?? "0", 10);
    return Math.max(0, euro * 100 + cents);
  }
  const intMatch = s.match(/([\d]{1,5})/);
  if (intMatch) return Math.max(0, parseInt(intMatch[1] ?? "0", 10) * 100);
  return 0;
}

async function loadFromSupabase(): Promise<AdminDataset | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const usersPromise = supabase
    .from("users")
    .select(
      "id,email,naam,leeftijd,created_at,email_verified_at,email_verify_token,last_seen_at"
    )
    .order("created_at", { ascending: false });

  const signupsPromise = supabase
    .from("onboarding_signups")
    .select("naam,email,leeftijd,created_at")
    .order("created_at", { ascending: false });

  const checkoutsPromise = supabase
    .from("stripe_checkouts")
    .select("session_id,user_id,credits,price_label,paid_at,fulfilled_at,amount_cents")
    .order("created_at", { ascending: false });

  const conversationsPromise = supabase
    .from("conversations")
    .select("id,owner_user_id,profile_id,profile_name,profile_avatar,updated_at,metadata")
    .order("updated_at", { ascending: false });

  const [usersRes, signupsRes, checkoutsRes, conversationsRes] = await Promise.all([
    usersPromise,
    signupsPromise,
    checkoutsPromise,
    conversationsPromise,
  ]);

  if (usersRes.error) {
    throw new Error(`[adminDataset] users: ${usersRes.error.message}`);
  }

  const users: AdminUserRow[] = (usersRes.data ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    naam: u.naam,
    leeftijd: u.leeftijd,
    createdAt: u.created_at,
    ...(u.email_verified_at ? { emailVerifiedAt: u.email_verified_at } : {}),
    ...(u.email_verify_token ? { emailVerifyToken: u.email_verify_token } : {}),
    ...(u.last_seen_at ? { lastSeenAt: u.last_seen_at } : {}),
  }));

  let signups: AdminSignupRow[] = [];
  let signupsSource: AdminDataset["source"]["signups"] = "supabase";
  if (signupsRes.error) {
    // Tabel bestaat (waarschijnlijk) niet — val terug op lokale JSON / blob hieronder.
    signupsSource = "local-json";
  } else {
    signups = (signupsRes.data ?? []).map((s) => ({
      naam: s.naam,
      email: s.email,
      leeftijd: s.leeftijd,
      createdAt: s.created_at,
    }));
  }

  if (signupsSource === "local-json" || signups.length === 0) {
    /** Aanvullen vanuit lokale store / blob (signups worden zowel daar als in users-tabel bijgehouden). */
    const local = readJson<AdminSignupRow[]>("onboarding-signups.json", []);
    if (local.length > 0) {
      signups = local;
    } else {
      const blob = await readJsonBlob<AdminSignupRow[]>("onboarding-signups.json", []);
      if (blob.length > 0) signups = blob;
    }
  }

  /**
   * Aanvulling: zorg dat élke Supabase-user ook als signup-row geldt (zelfde createdAt).
   * Hiermee blijven analytics kloppen ook als onboarding-signups niet (meer) bijgehouden wordt.
   */
  const signupEmails = new Set(signups.map((s) => s.email.toLowerCase()));
  for (const u of users) {
    if (!signupEmails.has(u.email.toLowerCase())) {
      signups.push({
        naam: u.naam,
        email: u.email,
        leeftijd: u.leeftijd,
        createdAt: u.createdAt,
      });
    }
  }

  if (checkoutsRes.error) {
    throw new Error(`[adminDataset] stripe_checkouts: ${checkoutsRes.error.message}`);
  }
  const checkouts: AdminStripeCheckoutRow[] = (checkoutsRes.data ?? []).map((c) => {
    const priceCents = (c as { amount_cents?: number | null }).amount_cents;
    const fromLabel = parsePriceLabelToCents(c.price_label);
    return {
      sessionId: c.session_id,
      userId: c.user_id ?? "",
      credits: c.credits ?? 0,
      priceLabel: c.price_label ?? "",
      ...(typeof priceCents === "number" && Number.isFinite(priceCents)
        ? { priceEurCents: priceCents }
        : fromLabel > 0
          ? { priceEurCents: fromLabel }
          : {}),
      ...(c.paid_at ? { paidAt: c.paid_at } : {}),
      ...(c.fulfilled_at ? { fulfilledAt: c.fulfilled_at } : {}),
    };
  });

  if (conversationsRes.error) {
    throw new Error(`[adminDataset] conversations: ${conversationsRes.error.message}`);
  }
  const convRows = (conversationsRes.data ?? []) as ConvRow[];
  const convIds = convRows.map((c) => c.id);
  const byConv = new Map<string, ChatMessage[]>();

  for (let i = 0; i < convIds.length; i += 500) {
    const slice = convIds.slice(i, i + 500);
    if (slice.length === 0) continue;
    const { data: msgRows, error: me } = await supabase
      .from("messages")
      .select("id,conversation_id,role,content,image_url,created_at,metadata")
      .in("conversation_id", slice)
      .order("created_at", { ascending: true });
    if (me) throw new Error(`[adminDataset] messages: ${me.message}`);
    for (const raw of msgRows ?? []) {
      const row = raw as MsgRow;
      const msg = messageFromRow(row);
      const arr = byConv.get(row.conversation_id) ?? [];
      arr.push(msg);
      byConv.set(row.conversation_id, arr);
    }
  }

  const conversations: Conversation[] = convRows.map((r) =>
    conversationFromRow(r, byConv.get(r.id) ?? [])
  );

  return {
    users,
    signups,
    conversations,
    checkouts,
    source: {
      users: "supabase",
      signups: signupsSource,
      conversations: "supabase",
      checkouts: "supabase",
    },
  };
}

async function loadFromBlob(): Promise<AdminDataset> {
  const [users, conversations, checkouts] = await Promise.all([
    readJsonBlob<AdminUserRow[]>("users.json", []),
    readJsonBlob<Conversation[]>("conversations.json", []),
    readJsonBlob<AdminStripeCheckoutRow[]>("stripe-checkouts.json", []),
  ]);
  const signupsLocal = readJson<AdminSignupRow[]>("onboarding-signups.json", []);
  const signupsBlob =
    signupsLocal.length > 0
      ? signupsLocal
      : await readJsonBlob<AdminSignupRow[]>("onboarding-signups.json", []);

  return {
    users,
    conversations,
    checkouts,
    signups: signupsBlob,
    source: {
      users: "blob",
      signups: signupsLocal.length > 0 ? "local-json" : "blob",
      conversations: "blob",
      checkouts: "blob",
    },
  };
}

/**
 * Centrale data-loader voor admin-views. Probeert Supabase eerst (bron van waarheid in productie);
 * valt terug op blob/lokale JSON als service-role niet beschikbaar is.
 */
export async function loadAdminDataset(): Promise<AdminDataset> {
  try {
    const fromSupabase = await loadFromSupabase();
    if (fromSupabase) return fromSupabase;
  } catch (e) {
    console.warn(
      "[adminDataset] Supabase laden mislukt — val terug op blob:",
      e instanceof Error ? e.message : e
    );
  }
  return loadFromBlob();
}
