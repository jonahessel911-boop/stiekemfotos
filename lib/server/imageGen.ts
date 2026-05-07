import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { saveConversationImage } from "@/lib/server/convImageStore";

const HF_SPACE = "https://mrfakename-z-image-turbo.hf.space";

/**
 * Snelle development-fallback: download een random fotostreepje
 * en sla het op als de bijlage bij dit assistent-bericht.
 *
 * Productie-image-generatie staat aan via `generateRealisticImage`,
 * maar voor MVP gebruiken we een placeholder zodat de UX-flow
 * (foto-vergrendeling, credits, ontgrendelen) instant te testen is.
 */
export async function fetchTestPhoto(
  conversationId: string,
  messageId: string
): Promise<string | null> {
  const seed =
    `${conversationId}-${messageId}-${Math.random().toString(36).slice(2, 10)}`;
  const candidates = [
    `https://picsum.photos/seed/${encodeURIComponent(seed)}/1024/1024`,
    `https://source.unsplash.com/1024x1024/?portrait,woman&sig=${encodeURIComponent(seed)}`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) continue;
      return await saveConversationImage(conversationId, messageId, buf, "image/jpeg");
    } catch (err) {
      console.warn("[testPhoto] fetch failed:", url, err);
    }
  }
  return null;
}

export type GenerateImageOptions = {
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  randomSeed?: boolean;
};

export async function generateRealisticImage(
  options: GenerateImageOptions,
  conversationId: string,
  messageId: string
): Promise<string | null> {
  const {
    prompt,
    width = 1024,
    height = 1024,
    steps = 9,
    seed = 42,
    randomSeed = true,
  } = options;

  // Try multiple endpoints and parameter formats
  const endpoints = [
    { name: "generate_image", params: [prompt, height, width, steps, seed, randomSeed] },
    { name: "generate_image_1", params: [prompt, height, width, steps, seed, randomSeed] },
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`[imageGen] Trying endpoint: ${endpoint.name}`);

      // Start generation
      const genRes = await fetch(`${HF_SPACE}/gradio_api/call/${endpoint.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: endpoint.params }),
      });

      const genText = await genRes.text();

      // Check for immediate error
      if (genText.includes("event: error")) {
        console.warn(`[imageGen] ${endpoint.name} returned error event`);
        continue; // try next endpoint
      }

      // Extract event_id
      let eventId: string | null = null;
      const jsonMatch = genText.match(/"event_id"\s*:\s*"([^"]+)"/);
      if (jsonMatch) eventId = jsonMatch[1];

      if (!eventId) {
        console.warn(`[imageGen] Could not parse event_id from ${endpoint.name}`);
        continue;
      }

      // Wait for generation (Gradio needs time)
      await new Promise((r) => setTimeout(r, 2000));

      // Poll result
      const resultRes = await fetch(`${HF_SPACE}/gradio_api/call/${endpoint.name}/${eventId}`, {
        method: "GET",
      });

      const resultText = await resultRes.text();

      // Check if result is also an error
      if (resultText.includes("event: error")) {
        console.warn(`[imageGen] ${endpoint.name} result is error event`);
        continue;
      }

      // Try to extract image URL / file path
      let imageUrl: string | null = null;

      // Pattern 1: standard url field
      const urlMatch = resultText.match(/"url"\s*:\s*"([^"]+)"/);
      if (urlMatch) imageUrl = urlMatch[1];

      // Pattern 2: file path in "name" field (Gradio often returns this)
      if (!imageUrl) {
        const nameMatch = resultText.match(/"name"\s*:\s*"([^"]+\.(jpg|jpeg|png|webp))"/i);
        if (nameMatch) {
          imageUrl = `${HF_SPACE}/file=${nameMatch[1]}`;
        }
      }

      // Pattern 3: any http(s) link to image
      if (!imageUrl) {
        const httpMatch = resultText.match(/(https?:\/\/[^"'\s]+\.(jpg|jpeg|png|webp))/i);
        if (httpMatch) imageUrl = httpMatch[1];
      }

      // Pattern 4: data URL (base64)
      if (!imageUrl) {
        const dataUrlMatch = resultText.match(/"(data:image\/[^"]+)"/);
        if (dataUrlMatch) imageUrl = dataUrlMatch[1];
      }

      if (!imageUrl) {
        console.warn(`[imageGen] No usable image URL from ${endpoint.name}. Raw:`, resultText.slice(0, 600));
        continue;
      }

      // Download image
      const imgRes = await fetch(imageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "image/*,*/*;q=0.8",
        },
      });

      if (!imgRes.ok) {
        console.warn(`[imageGen] Failed to download from ${imageUrl}, status: ${imgRes.status}`);
        continue;
      }

      const buffer = Buffer.from(await imgRes.arrayBuffer());

      // Save locally
      const imagesDir = path.join(process.cwd(), "data", "conv-images", conversationId);
      await mkdir(imagesDir, { recursive: true });

      const filename = `${messageId}.jpg`;
      const filePath = path.join(imagesDir, filename);
      await writeFile(filePath, buffer);

      console.log(`[imageGen] Successfully generated image via ${endpoint.name}`);
      return filename;
    } catch (err) {
      console.warn(`[imageGen] Exception on ${endpoint.name}:`, err);
      continue;
    }
  }

  console.error("[imageGen] All endpoints failed to generate image");
  return null;
}

export function buildNudePrompt(
  profileName: string,
  heritage: string | undefined,
  userRequest: string
): string {
  const ethnicity = heritage?.toLowerCase() || "european";

  let base = `ultra realistic low quality phone photo of a ${ethnicity} woman named ${profileName}, `;

  // Add user request context
  const req = userRequest.toLowerCase();

  if (req.includes("naakt") || req.includes("naked") || req.includes("nude")) {
    base += "completely naked, ";
  }
  if (req.includes("pijp") || req.includes("blowjob") || req.includes("mond")) {
    base += "on her knees giving blowjob, ";
  }
  if (req.includes("vagina") || req.includes("kut") || req.includes("pussy")) {
    base += "legs spread showing realistic detailed vagina, ";
  }
  if (req.includes("borsten") || req.includes("boobs") || req.includes("tits")) {
    base += "natural realistic breasts, ";
  }
  if (req.includes("selfie") || req.includes("foto")) {
    base += "candid phone selfie, ";
  }

  base += `real skin texture, visible pores, natural lighting, slightly blurry phone camera quality, low resolution, amateur photo, realistic body, no plastic skin, photorealistic, 24 years old`;

  return base;
}
