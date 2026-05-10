import { randomUUID } from "crypto";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import {
  loadPhotoRequestsRelational,
  savePhotoRequestsRelational,
} from "@/lib/server/photoRequestsRelational";
import type { PhotoRequest, PhotoRequestComment } from "@/lib/types/photo-request";
import { listDbProfiles } from "@/lib/server/profilesDb";
import { appendAssistantOutboundForOwner } from "@/lib/server/conversations";
import { findUserById } from "@/lib/server/users";
import { completeChat } from "@/lib/grok";

const FILE = "photo-requests.json";

const COMMENT_TEMPLATES = [
  "Ik maak hem graag voor je x, heb je een bericht gestuurd 💋",
  "Stuur me een bericht schat 😘",
  "Lijkt me heerlijk om deze voor je te maken.",
  "Ik kan dit wel voor je fixen, check je inbox 😏",
  "Leuke aanvraag, stuur me ff een dm.",
  "Ik meld me hiervoor aan, dit past precies bij mij.",
];

function clampCredits(n: number): number {
  if (!Number.isFinite(n)) return 25;
  return Math.max(5, Math.min(500, Math.round(n)));
}

async function loadAllPhotoRequests(): Promise<PhotoRequest[]> {
  const admin = getSupabaseAdmin();
  if (admin) {
    try {
      let all = await loadPhotoRequestsRelational(admin);
      if (all.length === 0) {
        const blob = await readJsonBlob<PhotoRequest[]>(FILE, []);
        if (blob.length > 0) {
          await savePhotoRequestsRelational(admin, blob);
          all = blob;
        }
      }
      return all.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch (e) {
      console.error("[photoRequests] relationele load mislukt, fallback blob:", e);
    }
  }
  const blob = await readJsonBlob<PhotoRequest[]>(FILE, []);
  return blob.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

async function savePhotoRequests(next: PhotoRequest[]): Promise<void> {
  const admin = getSupabaseAdmin();
  if (admin) {
    try {
      await savePhotoRequestsRelational(admin, next);
      return;
    } catch (e) {
      console.error("[photoRequests] relationele save mislukt, fallback blob:", e);
    }
  }
  await writeJsonBlob(FILE, next);
}

export async function listPhotoRequests(): Promise<PhotoRequest[]> {
  return loadAllPhotoRequests();
}

async function createAutoComments(ownerUserId: string): Promise<PhotoRequestComment[]> {
  void ownerUserId;
  const profiles = await listDbProfiles(18);
  if (profiles.length === 0) return [];
  const shuffled = [...profiles].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(4, shuffled.length));
  const out: PhotoRequestComment[] = [];
  for (let i = 0; i < selected.length; i++) {
    const p = selected[i]!;
    const template = COMMENT_TEMPLATES[Math.floor(Math.random() * COMMENT_TEMPLATES.length)]!;
    const comment: PhotoRequestComment = {
      id: randomUUID(),
      authorType: "profile",
      profileId: p.id,
      profileName: p.name,
      profileAvatar: p.photo,
      text: template,
      createdAt: new Date(Date.now() + i * 800).toISOString(),
      sentInboxMessage: false,
    };
    out.push(comment);
  }
  return out;
}

async function generateAutoCommentText(input: {
  profileName: string;
  requestDescription: string;
  photoType: string;
}): Promise<string> {
  try {
    const ai = await completeChat([
      {
        role: "system",
        content:
          "Schrijf 1 korte Nederlandse reactie (max 16 woorden) op een foto-aanvraag. Natuurlijk, speels, geen expliciete prijzen.",
      },
      {
        role: "user",
        content: [
          `Profielnaam: ${input.profileName}`,
          `Type aanvraag: ${input.photoType}`,
          `Omschrijving: ${input.requestDescription.slice(0, 200)}`,
          "Soms mag je subtiel zeggen dat je een bericht hebt gestuurd of dat hij inbox mag checken.",
          "Geef alleen de reactie-zin.",
        ].join("\n"),
      },
    ]);
    const cleaned = ai.replace(/\s+/g, " ").trim();
    if (cleaned.length >= 8) return cleaned.slice(0, 180);
  } catch {
    // fallback below
  }
  return COMMENT_TEMPLATES[Math.floor(Math.random() * COMMENT_TEMPLATES.length)]!;
}

export async function createPhotoRequest(input: {
  ownerUserId: string;
  description: string;
  photoType: string;
  maxCredits: number;
  photoCategory?: "naakt" | "lingerie" | "casual";
  wantedWhen?: "vandaag" | "morgen" | "binnen_1_week";
}): Promise<PhotoRequest> {
  const ownerUserId = input.ownerUserId.trim();
  const description = input.description.trim();
  const photoType = input.photoType.trim();
  if (!ownerUserId) throw new Error("Log in om een aanvraag te maken.");
  if (!description) throw new Error("Beschrijf wat je wilt zien.");
  if (!photoType) throw new Error("Vul het type foto in.");

  const now = new Date().toISOString();
  const created: PhotoRequest = {
    id: randomUUID(),
    ownerUserId,
    description,
    photoType,
    photoCategory: input.photoCategory,
    maxCredits: clampCredits(input.maxCredits),
    wantedWhen: input.wantedWhen,
    createdAt: now,
    updatedAt: now,
    comments: [],
  };

  const all = await loadAllPhotoRequests();
  const autoComments = await createAutoComments(ownerUserId);
  for (let i = 0; i < autoComments.length; i++) {
    const c = autoComments[i]!;
    if (c.authorType !== "profile") continue;
    c.text = await generateAutoCommentText({
      profileName: c.profileName ?? "schat",
      requestDescription: description,
      photoType,
    });
    const textSuggestsDm = /bericht gestuurd|check je inbox|dm|inbox/i.test(c.text);
    // Zorg dat elke aanvraag direct lead-berichten krijgt in inbox.
    c.sentInboxMessage = i < 2 || textSuggestsDm;
    if (c.sentInboxMessage && c.profileId) {
      try {
        await appendAssistantOutboundForOwner({
          ownerUserId,
          profileId: c.profileId,
          content: "ik zag je aanvraag net, stuur me een berichtje en ik maak hem voor je 😘",
        });
      } catch (e) {
        console.error("[photoRequests] auto inbox message failed:", e);
      }
    }
  }
  created.comments = autoComments;
  created.updatedAt = autoComments[autoComments.length - 1]?.createdAt ?? now;
  all.unshift(created);
  await savePhotoRequests(all);
  return created;
}

export async function addPhotoRequestComment(input: {
  actorUserId: string;
  requestId: string;
  profileId: string;
  text: string;
  sendInboxMessage?: boolean;
}): Promise<PhotoRequest> {
  const all = await loadAllPhotoRequests();
  const idx = all.findIndex((r) => r.id === input.requestId);
  if (idx < 0) throw new Error("Aanvraag niet gevonden.");
  const req = all[idx]!;
  const profiles = await listDbProfiles(200);
  const p = profiles.find((x) => x.id === input.profileId);
  if (!p) throw new Error("Profiel niet gevonden.");
  const comment: PhotoRequestComment = {
    id: randomUUID(),
    authorType: "profile",
    profileId: p.id,
    profileName: p.name,
    profileAvatar: p.photo,
    text: input.text.trim() || "Stuur me een bericht schat 😘",
    createdAt: new Date().toISOString(),
    sentInboxMessage: input.sendInboxMessage === true,
  };
  req.comments = [...req.comments, comment];
  req.updatedAt = comment.createdAt;
  all[idx] = req;
  await savePhotoRequests(all);
  if (comment.sentInboxMessage) {
    await appendAssistantOutboundForOwner({
      ownerUserId: req.ownerUserId,
      profileId: p.id,
      content: "ik heb je foto-aanvraag gezien, stuur me wat details en ik ga hem voor je maken 💋",
    });
  }
  return req;
}

export async function addUserCommentToPhotoRequest(input: {
  actorUserId: string;
  requestId: string;
  text: string;
}): Promise<PhotoRequest> {
  const actorUserId = input.actorUserId.trim();
  const text = input.text.trim();
  if (!actorUserId) throw new Error("Log in om te reageren.");
  if (!text) throw new Error("Reactie is leeg.");

  const all = await loadAllPhotoRequests();
  const idx = all.findIndex((r) => r.id === input.requestId);
  if (idx < 0) throw new Error("Aanvraag niet gevonden.");
  const req = all[idx]!;
  const user = await findUserById(actorUserId);
  const displayName = user?.naam?.trim() || "Bezoeker";
  const comment: PhotoRequestComment = {
    id: randomUUID(),
    authorType: "user",
    userId: actorUserId,
    userName: displayName,
    text,
    createdAt: new Date().toISOString(),
  };
  req.comments = [...req.comments, comment];
  req.updatedAt = comment.createdAt;
  all[idx] = req;
  await savePhotoRequests(all);
  return req;
}
