import { requireXaiApiKey } from "@/lib/xai-env";

const XAI_API = "https://api.x.ai/v1/chat/completions";

const CHAT_FETCH_MS = 120_000;

/** OpenAI-compatibel (aanbevolen voor /v1/chat/completions). */
export type GrokContentPartOpenAI =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "low" | "high" | "auto" };
    };

/** xAI native (fallback). */
export type GrokContentPartXai =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "low" | "high" };

export type GrokMessage = {
  role: "system" | "user" | "assistant";
  content: string | GrokContentPartOpenAI[] | GrokContentPartXai[];
};

/** xAI voorbeelden gebruiken soms overal `content: [{ type: "text", text }] i.p.v. raw string — voorkomt 422 Content. */
function normalizeStringContentToTextParts(messages: GrokMessage[]): GrokMessage[] {
  return messages.map((m) => {
    if (Array.isArray(m.content)) return m;
    const text = typeof m.content === "string" ? m.content : "";
    return {
      role: m.role,
      content: [{ type: "text", text } satisfies GrokContentPartOpenAI],
    };
  });
}

/** Sommige gateways verwachten tekst vóór image in dezelfde user-turn. */
function putTextBeforeImagesInUserTurns(messages: GrokMessage[]): GrokMessage[] {
  return messages.map((m) => {
    if (m.role !== "user" || typeof m.content === "string" || !Array.isArray(m.content)) {
      return m;
    }
    const parts = m.content as GrokContentPartOpenAI[];
    const texts = parts.filter((p): p is Extract<GrokContentPartOpenAI, { type: "text" }> => p.type === "text");
    const images = parts.filter(
      (p): p is Extract<GrokContentPartOpenAI, { type: "image_url" }> => p.type === "image_url"
    );
    if (images.length === 0) return m;
    return { role: "user", content: [...texts, ...images] };
  });
}

function stripOpenAIImageUrlDetail(messages: GrokMessage[]): GrokMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string" || !Array.isArray(m.content)) return m;
    const parts = (m.content as GrokContentPartOpenAI[]).map((p) => {
      if (p.type === "image_url" && p.image_url && "detail" in p.image_url && p.image_url.detail != null) {
        const { url } = p.image_url;
        return { type: "image_url" as const, image_url: { url } };
      }
      return p;
    });
    return { role: m.role, content: parts };
  });
}

function toXaiNativeMessages(messages: GrokMessage[]): GrokMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string" || m.role !== "user") return m;
    const first = m.content[0];
    if (!first || !("type" in first)) return m;
    if (first.type === "input_image" || first.type === "input_text") return m;

    const native: GrokContentPartXai[] = [];
    for (const p of m.content as GrokContentPartOpenAI[]) {
      if (p.type === "image_url") {
        native.push({
          type: "input_image",
          image_url: p.image_url.url,
        });
      } else if (p.type === "text") {
        native.push({ type: "input_text", text: p.text });
      }
    }
    return { role: "user", content: native };
  });
}

function stripInputImageDetail(messages: GrokMessage[]): GrokMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string" || m.role !== "user") return m;
    const parts = m.content;
    if (!Array.isArray(parts) || parts.length === 0) return m;
    const next = parts.map((p) => {
      if ("type" in p && p.type === "input_image" && "detail" in p && p.detail !== undefined) {
        const { detail: _d, ...rest } = p as {
          type: "input_image";
          image_url: string;
          detail?: string;
        };
        return rest;
      }
      return p;
    });
    return { role: "user", content: next as GrokContentPartXai[] };
  });
}

function uniqueMessageBodies(bodies: GrokMessage[][]): GrokMessage[][] {
  const seen = new Set<string>();
  return bodies.filter((b) => {
    const k = JSON.stringify(b);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function visionPayloadVariants(messages: GrokMessage[]): GrokMessage[][] {
  const base = putTextBeforeImagesInUserTurns(normalizeStringContentToTextParts(messages));
  const noDetail = stripOpenAIImageUrlDetail(base);
  const native = toXaiNativeMessages(base);
  const nativeStripped = stripInputImageDetail(native);
  return uniqueMessageBodies([base, noDetail, native, nativeStripped]);
}

export async function completeChat(
  messages: GrokMessage[],
  opts?: { hasImage?: boolean }
): Promise<string> {
  const key = requireXaiApiKey();

  const hasImage = opts?.hasImage === true;
  const model = hasImage
    ? process.env.XAI_VISION_MODEL?.trim() ||
      process.env.XAI_MODEL?.trim() ||
      "grok-4"
    : process.env.XAI_MODEL?.trim() || "grok-3-latest";

  const tryBodies = hasImage ? visionPayloadVariants(messages) : [messages];

  const payloadBase = {
    model,
    temperature: 0.88,
    /** Korte chat-replies (conversie); prompt vraagt 1–2 zinnen — cap helpt tegen laptekst. */
    max_tokens: 260,
  };

  let lastStatus = 0;
  let lastText = "";

  for (const body of tryBodies) {
    let res: Response;
    try {
      res = await fetch(XAI_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          ...payloadBase,
          messages: body,
        }),
        signal: AbortSignal.timeout(CHAT_FETCH_MS),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(
          `Grok-antwoord duurde langer dan ${CHAT_FETCH_MS / 1000}s. Probeer opnieuw of controleer api.x.ai.`
        );
      }
      throw e;
    }

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Geen antwoord van Grok");
      return content;
    }

    lastStatus = res.status;
    lastText = await res.text();
  }

  const hint = hasImage
    ? ` Tip: zet XAI_VISION_MODEL in .env.local op een vision-model dat jouw key mag gebruiken (console.x.ai → Models, bijv. grok-4).`
    : "";
  throw new Error(`Grok API fout (${lastStatus}): ${lastText.slice(0, 500)}${hint}`);
}
