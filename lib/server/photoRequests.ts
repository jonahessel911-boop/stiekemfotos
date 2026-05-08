import { randomUUID } from "crypto";
import { readJsonBlob, writeJsonBlob } from "@/lib/server/blobJson";
import type { PhotoRequest, PhotoRequestComment } from "@/lib/types/photo-request";
import { listDbProfiles } from "@/lib/server/profilesDb";
import { appendAssistantOutboundForOwner } from "@/lib/server/conversations";
import { findUserById } from "@/lib/server/users";

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

export async function listPhotoRequests(): Promise<PhotoRequest[]> {
  const all = await readJsonBlob<PhotoRequest[]>(FILE, []);
  return all
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function savePhotoRequests(next: PhotoRequest[]): Promise<void> {
  await writeJsonBlob(FILE, next);
}

async function createAutoComments(ownerUserId: string): Promise<PhotoRequestComment[]> {
  const profiles = await listDbProfiles(18);
  if (profiles.length === 0) return [];
  const shuffled = [...profiles].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(4, shuffled.length));
  const out: PhotoRequestComment[] = [];
  for (let i = 0; i < selected.length; i++) {
    const p = selected[i]!;
    const template = COMMENT_TEMPLATES[Math.floor(Math.random() * COMMENT_TEMPLATES.length)]!;
    const sentInboxMessage =
      /bericht gestuurd|check je inbox|dm/i.test(template) || Math.random() < 0.35;
    const comment: PhotoRequestComment = {
      id: randomUUID(),
      authorType: "profile",
      profileId: p.id,
      profileName: p.name,
      profileAvatar: p.photo,
      text: template,
      createdAt: new Date(Date.now() + i * 800).toISOString(),
      sentInboxMessage,
    };
    out.push(comment);
    if (sentInboxMessage) {
      await appendAssistantOutboundForOwner({
        ownerUserId,
        profileId: p.id,
        content: `hey schat, ik zag je foto-aanvraag en ik wil deze graag voor je maken 😘`,
      });
    }
  }
  return out;
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

  const all = await readJsonBlob<PhotoRequest[]>(FILE, []);
  const autoComments = await createAutoComments(ownerUserId);
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
  const all = await readJsonBlob<PhotoRequest[]>(FILE, []);
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

  const all = await readJsonBlob<PhotoRequest[]>(FILE, []);
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
