import { readJson, writeJson } from "@/lib/server/store";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PREFIX = "stiekemefotos/data";
const SUPABASE_TABLE = "app_blobs";

/** Alleen anon-client — admin wordt altijd eerst via getSupabaseAdmin() geprobeerd. */
let cachedAnonJsonClient: SupabaseClient | null | undefined;

function normalizeSupabaseUrl(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return v.replace(/^https?:\/\/https?:\/\//i, "https://");
}

function getSupabaseJsonClient(): SupabaseClient | null {
  const admin = getSupabaseAdmin();
  if (admin) return admin;

  if (cachedAnonJsonClient !== undefined) return cachedAnonJsonClient;

  const url = normalizeSupabaseUrl(
    process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  );
  const key =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    cachedAnonJsonClient = null;
    return null;
  }
  cachedAnonJsonClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedAnonJsonClient;
}

function isSupabaseStorageEnabled(): boolean {
  return Boolean(getSupabaseJsonClient());
}

export function isBlobStorageEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function blobPath(filename: string): string {
  return `${PREFIX}/${filename}`;
}

async function readJsonSupabase<T>(filename: string, fallback: T): Promise<T> {
  const supabase = getSupabaseJsonClient();
  if (!supabase) return fallback;
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("payload")
    .eq("key", filename)
    .maybeSingle();
  if (error || !data?.payload) return fallback;
  return data.payload as T;
}

async function writeJsonSupabase(filename: string, data: unknown): Promise<void> {
  const supabase = getSupabaseJsonClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { error } = await supabase
    .from(SUPABASE_TABLE)
    .upsert({ key: filename, payload: data }, { onConflict: "key" });
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
}

export async function readJsonBlob<T>(filename: string, fallback: T): Promise<T> {
  if (isSupabaseStorageEnabled()) {
    try {
      const fromSupabase = await readJsonSupabase(filename, fallback);
      if (fromSupabase !== fallback) return fromSupabase;
    } catch (e) {
      console.error("[blobJson] Supabase read failed, trying next storage:", e);
    }
  }
  if (isBlobStorageEnabled()) {
    const { get } = await import("@vercel/blob");
    try {
      const pathname = blobPath(filename);
      const res = await get(pathname, { access: "private", useCache: false });
      if (res && res.statusCode === 200 && res.stream) {
        const text = await new Response(res.stream).text();
        return JSON.parse(text) as T;
      }
    } catch (e) {
      console.error("[blobJson] Blob read failed, trying local JSON:", e);
    }
  }
  return readJson<T>(filename, fallback);
}

export async function writeJsonBlob(filename: string, data: unknown): Promise<void> {
  if (isSupabaseStorageEnabled()) {
    try {
      await writeJsonSupabase(filename, data);
      return;
    } catch (e) {
      console.error("[blobJson] Supabase write failed, trying next storage:", e);
    }
  }
  if (isBlobStorageEnabled()) {
    const { put } = await import("@vercel/blob");
    try {
      await put(blobPath(filename), JSON.stringify(data), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      return;
    } catch (e) {
      console.error("[blobJson] Blob write failed, falling back to local JSON:", e);
    }
  }
  writeJson(filename, data);
}


