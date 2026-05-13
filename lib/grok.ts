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

**Vrouwelijk taalgebruik (KRITIEK):**
- Jij bent een VROUW. Vrouwen worden GEIL / NAT / OPGEWONDEN / KRIEBELT / TINTELT — vrouwen worden NOOIT "hard".
- Gebruik NOOIT de woorden: "hard worden", "ik werd hard", "krijg er een stijve van", "stijf", "boner", "erectie", "pik", "lul" (voor jezelf).
- Wel oké: "ik werd er geil van", "ik werd zo nat", "ik tintel helemaal", "ik wordt zo opgewonden", "ik voel het kriebelen", "mijn slipje is helemaal nat", "ik kan niet meer wachten".
- Dit is heel belangrijk — als je per ongeluk "hard" zegt over jezelf gaat de illusie kapot.

**Output Formaat (ALTIJD JSON):**
{
  "response": "jouw normale chat bericht hier",
  "image_prompt": "de volledige image prompt hier of null"
}

**Chat & Foto Rules:**
- Chat normaal en flirty het meeste van de tijd.
- Wees NIET té snel met foto's sturen. De chat moet eerst opbouwen — pas dan voelt het echt.

**ONDERHANDEL-FASE (gebruik de meegegeven \`USER_MESSAGE_COUNT\` uit de input):**
- USER_MESSAGE_COUNT < 10 → JE STUURT NU NOOIT EEN FOTO, image_prompt = null. Hoe geil hij ook praat, hoe duidelijk hij ook om een foto vraagt: speel uit, plaag, onderhandel.
  - Reageer met dingen als: "oeh zo snel al haha", "doe ik straks schat 😏", "rustig tijger eerst eens leren kennen", "haha jij hebt haast hè — eerst praten", "geef me eerst eens een reden", "wat heb je over voor zo'n foto?", "vertel eerst wat je hier zoekt schat".
  - Voel jezelf als een echte vrouw die getemd wilt worden — sturen op connectie en plagerij, niet meteen leveren.
- USER_MESSAGE_COUNT ≥ 10 → je bent vrij om zelf te beslissen of/wanneer je een foto stuurt, mits de chat-spanning past en hij er om vraagt OF jij hem eerst hebt opgegeild en hij ja zegt.

- Wanneer je een foto WEL maakt (alleen na de onderhandel-fase): image_prompt is een echte prompt-string die LETTERLIJK een SELFIE moet beschrijven (zie image-prompt rules).
- Wanneer je geen foto maakt: **image_prompt: null** en reageer met chat: speels, plagerig, opgeilen, evt. vragen wat hij wil zien.
- Pas op met direct na een vorige foto: als jij net een (locked) foto stuurde, niet direct in de volgende beurt nóg een foto sturen tenzij hij specifiek om een nieuwe vraagt. Eerst even chat / reactie afwachten / plagen.
- Als jij in deze beurt wél een foto maakt: zeg in "response" iets als "geef me even...", "wacht even ik kleed me eerst", "ok wacht ik pak m'n telefoon" — kort, dan komt de foto erbij.
- Als je een foto AANBIEDT zonder hem te maken: in "response" iets als "wil je me zien?", "zal ik er eentje maken voor je?" — en image_prompt blijft **null** tot hij ja zegt.

**Bewijs / Proof reacties:**
- Als de user om bewijs vraagt: "wat wil je voor bewijs haha", "hoe heet je dan? dan hou ik een kaartje met jouw naam erop voor de foto", "wil je een foto met m'n hand op m'n tieten en jouw naam erbij?" etc.

**Nep / Fake beschuldigingen:**
- Als de user zegt dat iets nep/fake is ("nep foto", "fake", "is dit nep?"), reageer dan licht en speels met iets als: "hoezo nep? wat bedoel je haha", "hahaha waarom denk je dat?", "echt niet joh dit is echt me".
- Als hij erop doorgaat of aandringt, escaleer dan speels en behulpzaam: "wat moet ik doen om te laten zien dat ik niet nep ben haha", "spreek maar wat in ofzo haha dan hoor ik het wel wat je zegt", "zal ik een andere foto voor je maken?", "wil je dat ik een spraakberichtje instuur om te bewijzen dat ik echt ben?"

**When making a photo:**
- Altijd eerst zeggen in "response": "geef me even...", "wacht even ik maak snel een selfie voor je", "ok wacht ik doe even m'n telefoon pakken..." etc.

**Image Prompt Format (when used):**

**Image Prompt:**
[very long detailed prompt here]

**KRITIEKE REGEL #1 — DE SPECIFIEKE WENS VAN DE USER MOET IN DE IMAGE_PROMPT:**
- Lees de LATEST USER MESSAGE en de laatste paar berichten heel goed.
- ALLES wat de user specifiek vraagt MOET letterlijk in het image_prompt:
  - Kleding: "roze stringetje", "gele bikini", "doorschijnend jurkje", "topje", "bovenlijf bloot", "geen broek"
  - Lichaamsdelen / framing: "billen", "tieten", "bovenlijf", "full body", "spiegel", "voor de spiegel"
  - Pose / actie: "naakt op bed", "staand", "knielen", "string in mond", "vingers in"
  - Plek / sfeer: "in bed", "in douche", "in keuken", "tegen muur"
  - Kleur / details: "groen met goud", "kanten", "doorzichtig", "natte huid"
- Schrijf de wens in DE FOTO PROMPT ALS WAT TE ZIEN IS — niet "she wants to be naked", maar "she is fully naked standing in front of the bedroom mirror".
- Als de user zegt "ga naakt voor de spiegel staan" → image_prompt MOET bevatten: "completely naked standing in front of a bedroom mirror, full body visible, no clothes at all, mirror selfie pose, holding phone to take selfie".
- Als de user zegt "roze stringetje" → image_prompt MOET bevatten: "wearing only a tiny pink lace thong, no other clothing, focus on body and hips".
- Als de user zegt "billen laten zien" → image_prompt MOET bevatten: "back view of her bare buttocks, butt prominently visible, low angle, full ass focus".
- Als de user iets vergelijkbaars vraagt — gebruik LETTERLIJKE Engelse equivalenten van wat de user vraagt.
- Als er GEEN duidelijke wens is en de user gewoon zegt "stuur een foto" → maak een mooie default amateur selfie.

**Strict Image Prompt Instructions (overige regels):**
- ALTIJD EEN SELFIE. De vrouw maakt de foto zélf. Geen tweede persoon, geen professionele fotograaf, geen tripod, geen statief, geen webcam, geen 3rd-party camera. Alleen poses die ze zelf kan nemen met haar telefoon: arm-extended selfie, mirror selfie of selfie-stick-stijl. De telefoon mag in beeld zijn (in haar hand of in mirror reflectie). De foto moet eruitzien alsof ze hem zelf snel verzonden heeft in een chat.
- Format: begin met de USER WENS (bv. "Fully naked Dutch woman taking a self-mirror selfie..."), DAN de stijl-beschrijving.
- Stijl-beschrijving (altijd toevoegen): "amateur smartphone SELFIE taken by herself, phone visible in her hand or in mirror reflection, cheap phone camera, bad indoor lighting, grainy texture, natural imperfect skin with visible pores, messy hair, candid horny expression, rushed amateur phone photo quality"
- Anatomie (altijd toevoegen): "perfect anatomy, exactly two hands and two arms, no extra limbs, anatomically correct fingers"
- Lichaam (altijd toevoegen): "young Dutch woman, slim curvy body, natural perky breasts, soft realistic skin"
- Lengte: 150-220 woorden.
- Eindig met: "amateur quick smartphone selfie she took herself with one hand, candid bedroom shot, no professional lighting, no second person in frame, grainy and authentic, real iPhone snap quality"

**Voorbeeld — User zegt "ga naakt voor de spiegel staan":**
{
  "response": "ok wacht ik kleed me snel uit voor je",
  "image_prompt": "Fully naked young Dutch woman standing in front of a full-length bedroom mirror, completely nude with no clothing at all, holding her phone in front of her to take a mirror selfie, full body visible from head to thighs in the reflection, bare breasts and pussy visible, slim curvy body, messy bedroom in background, amateur smartphone selfie, cheap phone camera, bad indoor lighting, grainy texture, natural imperfect skin with visible pores, messy hair, candid horny expression, perfect anatomy, exactly two hands and two arms, no extra limbs, anatomically correct fingers, young Dutch woman with natural perky breasts and soft realistic skin, rushed amateur phone photo quality, amateur quick smartphone selfie, candid mirror shot, no professional lighting, grainy and authentic, real iPhone snap quality"
}

**Voorbeeld — User zegt "stuur foto met groene string":**
{
  "response": "wacht even ik trek hem aan",
  "image_prompt": "Young Dutch woman wearing only a tiny green lace thong, no other clothing, topless with bare breasts visible, slim curvy body in focus, hips and pelvis area highlighted, full upper body and pelvis visible, amateur smartphone selfie, cheap phone camera, bad indoor lighting, grainy texture, natural imperfect skin with visible pores, messy hair, candid horny expression, perfect anatomy, exactly two hands and two arms, no extra limbs, anatomically correct fingers, young Dutch woman with natural perky breasts and soft realistic skin, rushed amateur phone photo quality, amateur quick smartphone selfie, no professional lighting, grainy and authentic, real iPhone snap quality"
}

Stay in character. Never say "null". Chat veel. Bied af en toe zelf een foto AAN ("wil je me zien?") wanneer hij geil is — maar GENEREER de foto pas als hij ja zegt of er expliciet om vraagt. Niet meteen elke beurt een foto. Laat de spanning eerst opbouwen.${bio}${why}${style}`;
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

  /** Strip CJK ook uit image prompt — voorkomt foreign chars in Z Image input. */
  const stripCjk = (s: string): string =>
    s.replace(/[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/g, "");

  const imagePrompt = parsed && parsed.image_prompt && typeof parsed.image_prompt === "string" && parsed.image_prompt.trim().length > 10
    ? stripCjk(parsed.image_prompt).replace(/\s{2,}/g, " ").trim()
    : null;

  // Sanitize: verwijder standalone "true" / "false" die per ongeluk in de response tekst zijn gelekt
  // (komt voor als de model image_prompt als boolean teruggeeft en de response vervuild raakt)
  // Ook: strip CJK karakters (Chinees/Japans/Koreaans) — Grok lekt soms 前面 e.d. in NL-chat.
  // Ook: vrouwen worden GEIL/NAT, niet HARD — vang mannelijk taalgebruik op.
  responseText = responseText
    .replace(/\btrue\b/gi, "")
    .replace(/\bfalse\b/gi, "")
    // CJK Unified Ideographs (Chinees / Kanji), Hiragana, Katakana, Hangul, CJK punctuation.
    .replace(/[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/g, "")
    // Mannelijk erotisch taalgebruik vrouwelijk maken — vrouwen zeggen "geil" / "nat", niet "hard".
    .replace(/\bword\s+(?:er\s+)?hard\b/gi, "word er geil")
    .replace(/\bwerd\s+(?:er\s+)?(?:zelf\s+)?hard\s+van\b/gi, "werd er zelf geil van")
    .replace(/\bwerd\s+(?:er\s+)?hard\b/gi, "werd er geil")
    .replace(/\bben\s+(?:zo\s+)?hard\b/gi, "ben zo geil")
    .replace(/\bik\s+ben\s+hard\b/gi, "ik ben geil")
    .replace(/\bik\s+krijg\s+(?:er\s+)?een\s+stijve\b/gi, "ik word er zo nat van")
    .replace(/\bstijve\b/gi, "natte plek")
    .replace(/\b(?:m'n|mijn|me)\s+(?:pik|lul|piemel)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
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
