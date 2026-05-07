import { readJson, writeJson } from "@/lib/server/store";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

const PREFIX = "discreetemeisjes/data";
const SUPABASE_TABLE = "app_blobs";

function isSupabaseStorageEnabled(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export function isBlobStorageEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function blobPath(filename: string): string {
  return `${PREFIX}/${filename}`;
}

async function readJsonSupabase<T>(filename: string, fallback: T): Promise<T> {
  const supabase = getSupabaseAdmin();
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
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase admin client not configured");
  const { error } = await supabase
    .from(SUPABASE_TABLE)
    .upsert({ key: filename, payload: data }, { onConflict: "key" });
  if (error) throw new Error(`Supabase write failed: ${error.message}`);
}

export async function readJsonBlob<T>(filename: string, fallback: T): Promise<T> {
  if (isSupabaseStorageEnabled()) {
    try {
      return await readJsonSupabase(filename, fallback);
    } catch {
      return fallback;
    }
  }
  if (!isBlobStorageEnabled()) {
    return readJson<T>(filename, fallback);
  }
  const { get } = await import("@vercel/blob");
  try {
    const pathname = blobPath(filename);
    const res = await get(pathname, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return fallback;
    const text = await new Response(res.stream).text();
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonBlob(filename: string, data: unknown): Promise<void> {
  if (isSupabaseStorageEnabled()) {
    await writeJsonSupabase(filename, data);
    return;
  }
  if (!isBlobStorageEnabled()) {
    writeJson(filename, data);
    return;
  }
  const { put } = await import("@vercel/blob");
  await put(blobPath(filename), JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}
