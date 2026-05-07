import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export type AnimationKey = "gift_closed" | "gift_open";

const FALLBACK_FILE = "animations.json";
const TABLE = "app_animations";

type FallbackRow = {
  key: AnimationKey;
  url: string;
  updatedAt: string;
  mime?: string;
  sizeBytes?: number;
};

async function fallbackReadAll(): Promise<Record<string, FallbackRow>> {
  return readJsonBlob<Record<string, FallbackRow>>(FALLBACK_FILE, {});
}

async function fallbackWriteAll(next: Record<string, FallbackRow>): Promise<void> {
  await writeJsonBlob(FALLBACK_FILE, next);
}

export async function getAnimationUrl(key: AnimationKey): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("url")
      .eq("key", key)
      .maybeSingle();
    if (!error && data?.url) return String(data.url);
  }

  const all = await fallbackReadAll();
  return all[key]?.url ?? null;
}

export async function upsertAnimationUrl(input: {
  key: AnimationKey;
  url: string;
  mime?: string;
  sizeBytes?: number;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from(TABLE).upsert(
      {
        key: input.key,
        url: input.url,
        mime: input.mime ?? null,
        size_bytes: input.sizeBytes ?? null,
      },
      { onConflict: "key" }
    );
    if (!error) return;
  }

  const all = await fallbackReadAll();
  all[input.key] = {
    key: input.key,
    url: input.url,
    mime: input.mime,
    sizeBytes: input.sizeBytes,
    updatedAt: new Date().toISOString(),
  };
  await fallbackWriteAll(all);
}

