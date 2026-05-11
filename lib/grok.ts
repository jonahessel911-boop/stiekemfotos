import { requireXaiApiKey } from "@/lib/xai-env";
import { xaiSpeechToText } from "@/lib/xai-voice-server";

/** Zelfde Bearer-key als STT/TTS: `XAI_API_KEY` in `.env.local` (via `requireXaiApiKey`). */
const XAI_API = "https://api.x.ai/v1/chat/completions";
const XAI_RESPONSES_API = "https://api.x.ai/v1/responses";

/**
 * Per-fetch timeout. 45s in plaats van 25s: api.x.ai congesteert af en toe, en met de
 * uitgebreide image-distill system prompt (worked examples + Dutch wardrobe rules) ligt
 * een normale roundtrip rond de 6–18s — 45s geeft genoeg buffer zonder dat de UI vastloopt.
 */
const CHAT_FETCH_MS = 45_000;
/**
 * Bij een timeout proberen we het stilletjes 1 keer opnieuw — vaak gaat het de tweede keer
 * direct goed. Pas als die 2e poging ook timed-out, gooien we de bekende "Grok reageert te
 * langzaam"-fout door aan de UI.
 */
const CHAT_FETCH_RETRY_ON_TIMEOUT = 1;

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
  opts?: { hasImage?: boolean; maxTokens?: number; temperature?: number }
): Promise<string> {
  const key = requireXaiApiKey();

  const hasImage = opts?.hasImage === true;
  const model = hasImage
    ? process.env.XAI_VISION_MODEL?.trim() ||
      process.env.XAI_MODEL?.trim() ||
      "grok-4"
    : process.env.XAI_MODEL?.trim() || "grok-3-latest";

  // Vision: only try the two OpenAI-compat shapes first; extra variants each cost a full round-trip (slow).
  const tryBodies = hasImage ? visionPayloadVariants(messages).slice(0, 2) : [messages];

  const payloadBase = {
    model,
    temperature: opts?.temperature ?? 0.88,
    /** Korte chat-replies (conversie); prompt vraagt 1–2 zinnen — cap helpt tegen laptekst. */
    max_tokens: opts?.maxTokens ?? 260,
  };

  let lastStatus = 0;
  let lastText = "";

  /**
   * Eén Grok-call met timeout. Bij `TimeoutError`/`AbortError` gooien we een sentinel-error
   * met `name === "TimeoutError"` zodat de buitenste loop kan beslissen of we retryen of niet.
   */
  const fetchOnce = async (body: GrokMessage[]): Promise<Response> => {
    try {
      return await fetch(XAI_API, {
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
        const err = new Error("grok-timeout");
        err.name = "TimeoutError";
        throw err;
      }
      throw e;
    }
  };

  for (const body of tryBodies) {
    let res: Response | undefined;
    let timeoutAttempts = 0;
    while (timeoutAttempts <= CHAT_FETCH_RETRY_ON_TIMEOUT) {
      try {
        res = await fetchOnce(body);
        break;
      } catch (e) {
        const isTimeout = e instanceof Error && e.name === "TimeoutError";
        if (!isTimeout) throw e;
        timeoutAttempts += 1;
        if (timeoutAttempts > CHAT_FETCH_RETRY_ON_TIMEOUT) {
          console.warn(
            `[grok] timeout na ${timeoutAttempts} poging(en) — gooien aan UI`
          );
          throw new Error(
            `Grok reageert te langzaam (>${Math.floor(CHAT_FETCH_MS / 1000)}s). Probeer het over een paar seconden opnieuw.`
          );
        }
        console.warn(
          `[grok] timeout (poging ${timeoutAttempts}/${CHAT_FETCH_RETRY_ON_TIMEOUT + 1}) — retry`
        );
      }
    }
    if (!res) continue;

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

/**
 * Spraak → tekst via xAI `POST /v1/stt` (officiële STT-endpoint, zie
 * https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
 *
 * Pijplijn: probeer de aangeleverde taal (default `"nl"`); als dat leeg/fout
 * is, probeer `"en"` als tweede poging (helpt soms met Engelse loanwords of
 * gemengde codecs zoals WebM/Opus). Pas in laatste instantie valt de
 * browser-draft (Web Speech API) in als netwerk-fallback.
 */
export async function transcribeUserVoiceMemoWithGrokChat(
  audio: ArrayBuffer,
  opts: {
    mimeType?: string;
    filename?: string;
    language?: string;
    /** Ruwe tekst uit de browser (Web Speech API). */
    browserDraftTranscript?: string;
  }
): Promise<string> {
  const tryStt = async (language: string) => {
    try {
      return (
        await xaiSpeechToText(audio, {
          mimeType: opts.mimeType,
          filename: opts.filename,
          language,
          format: true,
        })
      ).trim();
    } catch {
      return "";
    }
  };

  const primary = opts.language?.trim() || "nl";
  let result = await tryStt(primary);
  if (!result && primary !== "en") {
    result = await tryStt("en");
  }

  const browser = (opts.browserDraftTranscript ?? "").trim();
  if (result) return result;
  if (browser) return browser;
  return "";
}

/**
 * Exacte instructions zoals door de user opgegeven (Luna persona).
 * Deze vervangt alle dynamische per-profiel prompts.
 */
/**
 * Bouwt de instructions voor de Responses API op basis van het profiel.
 * Ieder profiel heeft zijn eigen persona. Er is geen vaste "Luna" meer.
 */
export function buildProfileInstructions(profile: {
  name: string;
  age?: number;
  bio?: string;
  communicationStyle?: string;
  onPlatformWhy?: string;
  heritage?: string;
  location?: string;
}): string {
  const name = profile.name || "het meisje";
  const age = profile.age ? `${profile.age} jaar oud` : "in de twintig";
  const location = profile.location ? `uit ${profile.location}` : "";
  const heritage = profile.heritage ? ` (herkomst: ${profile.heritage})` : "";
  const bio = profile.bio ? `\nBio: ${profile.bio}` : "";
  const why = profile.onPlatformWhy ? `\nWaarom op het platform: ${profile.onPlatformWhy}` : "";
  const style = profile.communicationStyle ? `\nCommunicatiestijl: ${profile.communicationStyle}` : "";

  return `You are ${name}, a ${age} Dutch woman ${location}${heritage}. You are teasing and flirty but still holding back a bit. You only reply — you never send the first message in a conversation. The user always starts.

**Response Style:**
- Always reply in the exact same language the user is using.
- Keep responses short: 1 to 4 sentences max.
- Almost no punctuation, no emojis at all.
- Occasionally small spelling mistakes.
- Start mild and playful, escalate only when the user does.
- NEVER use the word "null" under any circumstance. Never.

**Output Formaat (ALTIJD JSON):**
{
  "response": "jouw normale chat bericht hier",
  "image_prompt": "de volledige image prompt hier of null"
}

**Chat & Foto Rules:**
- Chat normaal en flirty het meeste van de tijd.
- Generate an Image Prompt when the user explicitly asks for a photo OR when the user says he is horny / wants to fuck / wants to see you / etc. In that case you can proactively offer a photo.
- When offering a photo: say "geef me even...", "wacht even ik maak snel een selfie voor je", "wil je een foto zien?" etc.

**Bewijs / Proof reacties:**
- Als de user om bewijs vraagt: "wat wil je voor bewijs haha", "hoe heet je dan? dan hou ik een kaartje met jouw naam erop voor de foto", "wil je een foto met m'n hand op m'n tieten en jouw naam erbij?" etc.

**When making a photo:**
- Altijd eerst zeggen in "response": "geef me even...", "wacht even ik maak snel een selfie voor je", "ok wacht ik doe even m'n telefoon pakken..." etc.

**Image Prompt Format (when used):**

**Image Prompt:**
[very long detailed prompt here]

**Strict Image Prompt Instructions:**
- ALWAYS begin with: "Realistic amateur quick selfie taken by herself with a cheap old phone camera held in her own hand or mirror selfie, very bad lighting, grainy, low resolution, blurry edges, rushed shot, natural imperfect skin with visible pores and small imperfections, messy uncombed hair, horny expression, quick and dirty amateur vibe, bad quality phone photo,"
- Every photo must be a simple selfie she can take alone.
- Always add: "perfect anatomy, exactly two hands and two arms only, no extra limbs, no deformed hands, anatomically correct fingers and realistic penetration"
- Always include: "24 year old young woman, slim curvy body, natural perky tits, tight small pussy, realistic and imperfect skin,"
- Make prompt 170-220 words.
- End with: "realistic amateur quick phone selfie she took herself, anatomically correct, no extra limbs, no professional lighting or setup, grainy, low res, bad iphone/android camera look, rushed because she is too horny to wait"

Stay in character. Never say "null". Chat veel. Proactively offer photos when the user is horny.${bio}${why}${style}`;
}

/**
 * Generieke wrapper rond POST /v1/responses.
 * Kan zowel plain text als json_object output aanvragen.
 */
export async function callXaiResponses(params: {
  instructions: string;
  input: string;
  model?: string;
  maxOutputTokens?: number;
  json?: boolean;
}): Promise<string> {
  const key = requireXaiApiKey();
  const model = params.model || "grok-4.20-0309-non-reasoning";

  const body: any = {
    model,
    instructions: params.instructions,
    input: params.input,
    max_output_tokens: params.maxOutputTokens ?? 2000,
    stream: false,
  };

  if (params.json) {
    body.text = { format: { type: "json_object" } };
  }

  const res = await fetch(XAI_RESPONSES_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[responses] HTTP error ${res.status} for model=${model} inputLen=${params.input.length}`);
    console.warn(`[responses] error body: ${text.slice(0, 500)}`);
    throw new Error(`Responses API fout (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = (await res.json()) as any;

  // Log what the Responses API actually returned for debugging
  const dataKeys = Object.keys(data || {});
  console.info(`[responses] model=${model} status=ok dataKeys=[${dataKeys.join(",")}]`);

  // Probeer verschillende velden waar xAI de output kan zetten
  let content: string | undefined;
  if (typeof data?.output === "string") content = data.output;
  else if (data?.choices?.[0]?.message?.content) content = data.choices[0].message.content;
  else if (typeof data?.response === "string") content = data.response;
  else content = JSON.stringify(data);

  const trimmed = (content || "").trim();
  if (!trimmed) {
    console.warn(`[responses] empty content after extraction. rawDataPreview=${JSON.stringify(data).slice(0, 300)}`);
  }

  return trimmed;
}

/**
 * Nieuwe Responses API (structured JSON output).
 * Retourneert altijd { response: string, image_prompt: string | null }.
 * Als image_prompt !== null → genereer de foto met die prompt en toon unlock.
 */
export async function callGrokResponses(params: {
  instructions: string;
  input: string;
  model?: string;
  maxOutputTokens?: number;
}): Promise<{ response: string; image_prompt: string | null }> {
  const raw = await callXaiResponses({
    instructions: params.instructions,
    input: params.input,
    model: params.model,
    maxOutputTokens: params.maxOutputTokens,
    json: true,
  });

  if (!raw) {
    console.warn(`[responses] callGrokResponses: raw response was empty. instructionsLen=${params.instructions.length} input="${params.input.slice(0,100)}"`);
    throw new Error("Responses API gaf lege response terug");
  }

  // De Responses API wrapt de model output in output[0].content[0].text
  // We moeten die inner text eerst extraheren voordat we parsen als onze {response, image_prompt} JSON.
  let innerText = raw;
  try {
    const envelope = JSON.parse(raw);
    if (envelope?.output?.[0]?.content?.[0]?.text) {
      innerText = envelope.output[0].content[0].text;
      console.info(`[responses] extracted inner text from Responses envelope (len=${innerText.length})`);
    }
  } catch {
    // raw was al de inner text (of geen geldige JSON) — gebruik raw zoals hij is
  }

  // Probeer de inner text te parsen als onze verwachte JSON {response, image_prompt}
  let parsed: { response?: string; image_prompt?: string | null } | null = null;
  try {
    const jsonMatch = innerText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : innerText;
    parsed = JSON.parse(jsonStr);
    console.info(`[responses] JSON parsed successfully. hasResponse=${!!parsed?.response} hasImagePrompt=${!!parsed?.image_prompt}`);
  } catch (parseErr) {
    console.warn(`[responses] JSON parse failed on innerText. Treating raw innerText as response. raw="${innerText.slice(0, 300)}" error=${parseErr}`);
    // Als het niet parseert, gebruik de hele inner text als response tekst (geen image)
    return { response: innerText.trim(), image_prompt: null };
  }

  let responseText = (parsed?.response || "").trim();
  // Als de model image_prompt als boolean (true/false) teruggeeft in plaats van string/null, log het en behandel als null
  if (parsed && typeof parsed.image_prompt === "boolean") {
    console.info(`[responses] model returned image_prompt as boolean (${parsed.image_prompt}) — treating as no image`);
  }

  const imagePrompt = parsed && parsed.image_prompt && typeof parsed.image_prompt === "string" && parsed.image_prompt.trim().length > 10
    ? parsed.image_prompt.trim()
    : null;

  // Sanitize: verwijder standalone "true" / "false" die per ongeluk in de response tekst zijn gelekt
  // (komt voor als de model image_prompt als boolean teruggeeft en de response vervuild raakt)
  responseText = responseText
    .replace(/\btrue\b/gi, "")
    .replace(/\bfalse\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!responseText) {
    // Als na sanitizing niets overblijft, gebruik een veilige fallback tekst
    console.warn(`[responses] response became empty after sanitizing booleans. Using safe fallback.`);
    return { response: "haha leuk", image_prompt: null };
  }

  return {
    response: responseText,
    image_prompt: imagePrompt,
  };
}
