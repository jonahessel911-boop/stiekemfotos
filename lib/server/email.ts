import { getSiteUrl } from "@/lib/site-url";

const POSTMARK_URL = "https://api.postmarkapp.com/email";

const POSTMARK_SERVER_TOKEN =
  process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN ?? "";
/** Vast afzenderadres voor alle Postmark-transactional mail. */
export const POSTMARK_FROM_EMAIL = "info@stiekemefotos.nl";
const POSTMARK_FROM_HEADER = `Stiekemefotos <${POSTMARK_FROM_EMAIL}>`;

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Dagelijkse engagement-mail. CTA gaat naar `/profielen` zodat de user weer
 * binnen het platform belandt — de page-load triggert `touchUserSeen` (KPI:
 * re-sign %). Eventueel kan je een paar profielnamen + avatars meegeven die
 * "vandaag zijn toegevoegd" om de mail persoonlijker te maken.
 */
export async function sendDailyChatPromptEmail(input: {
  to: string;
  naam: string;
  /** Optioneel: 1-4 profiel-previews om in de mail te tonen. */
  newProfiles?: Array<{ name: string; avatarUrl?: string | null }>;
}): Promise<void> {
  const ctaUrl = `${getSiteUrl()}/profielen?utm_source=email&utm_medium=daily&utm_campaign=new-women`;
  const nm = escapeHtml(input.naam || "schat");
  const previews = (input.newProfiles ?? []).slice(0, 4);
  const previewHtml = previews.length
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 14px 0;border-collapse:collapse;">
        <tr>${previews
          .map((p) => {
            const name = escapeHtml(p.name);
            const avatar = p.avatarUrl && /^https?:\/\//i.test(p.avatarUrl)
              ? `<img src="${escapeHtml(p.avatarUrl)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:999px;border:2px solid #fce7f3;" />`
              : `<div style="width:64px;height:64px;border-radius:999px;background:#fce7f3;display:inline-block;"></div>`;
            return `<td style="padding:0 6px;text-align:center;">
              ${avatar}
              <div style="margin-top:6px;font-size:12px;font-weight:700;color:#0f172a;">${name}</div>
            </td>`;
          })
          .join("")}</tr>
      </table>`
    : "";
  const body = `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      Hey ${nm},
    </p>
    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;">
      <b>Deze vrouwen hebben zichzelf vandaag aangemeld</b> op stiekemefotos.nl
      en willen graag chatten — en foto's voor je maken.
    </p>
    ${previewHtml}
    <p style="margin:0;font-size:15px;line-height:1.6;">
      Klik hieronder en zie wie er nu online is.
    </p>`;
  const t = shellTemplate(
    "Deze vrouwen hebben zichzelf vandaag aangemeld 💋",
    "Nieuwe profielen online — wie spreek jij vanavond?",
    "Bekijk profielen",
    ctaUrl,
    body
  );
  await sendMail({
    to: input.to,
    subject: "Deze vrouwen hebben zichzelf vandaag aangemeld — stiekemefotos.nl",
    html: t.html,
    text: `Deze vrouwen hebben zichzelf vandaag aangemeld op stiekemefotos.nl.\n\nBekijk profielen: ${ctaUrl}`,
  });
}

function shellTemplate(title: string, subtitle: string, ctaText: string, ctaHref: string, body: string) {
  const safeHref = ctaHref.startsWith("http")
    ? ctaHref
    : `${getSiteUrl()}${ctaHref.startsWith("/") ? ctaHref : `/${ctaHref}`}`;
  return {
    html: `<!doctype html>
<html lang="nl">
  <body style="margin:0;padding:0;background:#f3f4f8;font-family:Inter,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:22px;overflow:hidden;box-shadow:0 18px 40px rgba(15,23,42,.08);">
            <tr>
              <td style="padding:22px 24px;background:#ffffff;border-bottom:1px solid #eef0f4;">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;" colspan="2">
                      <div style="font-size:28px;font-weight:400;font-family:Impact,'Arial Black',Arial,sans-serif;letter-spacing:0.03em;line-height:1;color:#dc2626;text-transform:uppercase;">Ontmoetjongens</div>
                      <div style="margin-top:4px;font-size:12px;color:#6b7280;font-weight:600;">Discreet en persoonlijk contact</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <div style="font-size:32px;font-weight:800;line-height:1.15;color:#0f172a;">${title}</div>
                <div style="margin-top:10px;font-size:19px;font-weight:600;color:#374151;">${subtitle}</div>
                <div style="margin-top:16px;height:3px;width:74px;background:#dc2626;border-radius:999px;"></div>
                <div style="margin-top:20px;">
                ${body}
                </div>
                <div style="margin-top:26px;">
                  <a href="${safeHref}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:800;font-size:16px;">${ctaText}</a>
                </div>
                <p style="margin-top:18px;font-size:12px;color:#6b7280;">
                  18+ · Privé en discreet. Als je dit niet wilt ontvangen, log in en pas je voorkeuren aan.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `${title}\n${subtitle}\n\nOpen: ${safeHref}`,
  };
}

async function sendMail(payload: MailPayload): Promise<void> {
  if (!POSTMARK_SERVER_TOKEN) {
    throw new Error("POSTMARK_SERVER_TOKEN ontbreekt. Verificatiemail kan niet worden verstuurd.");
  }
  if (!payload.to) {
    throw new Error("Ontvanger ontbreekt voor e-mailverzending.");
  }
  if (!POSTMARK_FROM_EMAIL.includes("@")) {
    throw new Error("POSTMARK_FROM_EMAIL is ongeldig geconfigureerd.");
  }
  const res = await fetch(POSTMARK_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
    },
    body: JSON.stringify({
      From: POSTMARK_FROM_HEADER,
      ReplyTo: POSTMARK_FROM_EMAIL,
      To: payload.to,
      Subject: payload.subject,
      HtmlBody: payload.html,
      TextBody: payload.text,
      MessageStream: "outbound",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark fout (${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function sendAccountVerificationEmail(input: {
  to: string;
  naam: string;
  verifyToken: string;
}): Promise<void> {
  const verifyUrl = `${getSiteUrl()}/api/auth/verify-email?token=${encodeURIComponent(input.verifyToken)}`;
  const t = shellTemplate(
    `Bijna klaar ${input.naam} 💌`,
    "Bevestig eerst je e-mailadres om stiekemefotos te openen.",
    "Bevestig mijn e-mail",
    verifyUrl,
    `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      Je account is aangemaakt. Klik op de knop hieronder om je e-mailadres te bevestigen.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;">
      Daarna kun je direct de discreete meisjes zien en chatten.
    </p>`
  );
  await sendMail({
    to: input.to,
    subject: "Bevestig je e-mail voor stiekemefotos.nl",
    html: t.html,
    text: `${t.text}\n\nBevestig je e-mail: ${verifyUrl}`,
  });
}

export async function sendOntmoetjongensAccessEmail(input: {
  to: string;
  naam: string;
  loginLink: string;
}): Promise<void> {
  const nm = escapeHtml(input.naam || "daar");
  const setupHref = input.loginLink.startsWith("http")
    ? input.loginLink
    : `${getSiteUrl()}${input.loginLink}`;
  const body = `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      Hoi ${nm}, gefeliciteerd — je bent toegelaten.
    </p>
    <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      Je toegang staat klaar. Klik hieronder, maak in een minuut je wachtwoord aan
      en ontdek hoe je kunt chatten en afspreken.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;">
      Een simpele hoi is vaak genoeg om iets leuks te starten.
    </p>`;
  const t = shellTemplate(
    "Je bent toegelaten 🎉",
    "Maak je wachtwoord aan en ga naar het platform",
    "Ga naar platform",
    setupHref,
    body
  );
  await sendMail({
    to: input.to,
    subject: "Je bent toegelaten — stiekemefotos.nl",
    html: t.html,
    text: `${t.text}\n\nGa naar platform: ${setupHref}`,
  });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  naam: string;
  resetToken: string;
}): Promise<void> {
  const resetUrl = `${getSiteUrl()}/wachtwoord-reset?token=${encodeURIComponent(input.resetToken)}&flow=reset`;
  const t = shellTemplate(
    `Nieuw wachtwoord instellen 🔐`,
    `Hey ${input.naam}, je hebt een nieuw wachtwoord aangevraagd.`,
    "Wachtwoord instellen",
    resetUrl,
    `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      Klik op de knop hieronder om een nieuw wachtwoord te kiezen. De link is 1 uur geldig.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;">
      Heb je dit niet aangevraagd? Negeer deze e-mail dan — je wachtwoord blijft hetzelfde.
    </p>`
  );
  await sendMail({
    to: input.to,
    subject: "Stel je wachtwoord opnieuw in — stiekemefotos.nl",
    html: t.html,
    text: `${t.text}\n\nWachtwoord resetten: ${resetUrl}`,
  });
}

const DEFAULT_ADMIN_NOTIFY_EMAIL = "jonahessel911@gmail.com";

export function getAdminNotifyEmail(): string {
  return (process.env.ADMIN_NOTIFY_EMAIL ?? DEFAULT_ADMIN_NOTIFY_EMAIL).trim();
}

export async function sendAdminNewUserMessageEmail(input: {
  to: string;
  profileName: string;
  userName: string;
  userEmail: string;
  preview: string;
  conversationId: string;
}): Promise<void> {
  const adminChatsUrl = `${getSiteUrl()}/admin/chats`;
  const safePreview = escapeHtml(input.preview);
  const safeUser = escapeHtml(input.userName || "Gebruiker");
  const safeEmail = escapeHtml(input.userEmail || "—");
  const safeProfile = escapeHtml(input.profileName || "profiel");
  const t = shellTemplate(
    `Nieuw bericht → ${input.profileName}`,
    `${input.userName} wacht op een antwoord in de admin-chat.`,
    "Open admin chats",
    adminChatsUrl,
    `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      <b>${safeUser}</b> (${safeEmail}) stuurde een bericht aan <b>${safeProfile}</b>.
    </p>
    <blockquote style="margin:0 0 12px 0;border-left:4px solid #e2e8f0;padding:8px 12px;color:#334155;background:#f8fafc;border-radius:8px;">
      ${safePreview}
    </blockquote>
    <p style="margin:0;font-size:14px;line-height:1.5;color:#64748b;">
      Log in op het admin-panel (admin@admin.nl) en antwoord handmatig in Chats.
    </p>`
  );
  await sendMail({
    to: input.to,
    subject: `Chat: ${input.userName} → ${input.profileName}`,
    html: t.html,
    text: `${t.text}\n\nBericht: ${input.preview}\n\nAdmin: ${adminChatsUrl}`,
  });
}

export async function sendOfflineNewMessageEmail(input: {
  to: string;
  naam: string;
  profileName: string;
  preview: string;
  conversationId: string;
}): Promise<void> {
  const t = shellTemplate(
    `${input.profileName} stuurde je iets spannends 💬`,
    "Je was net offline. Er wacht een nieuw bericht op je.",
    "Lees bericht",
    `${getSiteUrl()}/berichten?chat=${encodeURIComponent(input.conversationId)}`,
    `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      Hey ${input.naam}, <b>${input.profileName}</b> heeft je een bericht gestuurd.
    </p>
    <blockquote style="margin:0;border-left:4px solid #cfead8;padding:8px 12px;color:#1f3a2a;background:#f4fbf7;border-radius:8px;">
      ${input.preview}
    </blockquote>`
  );
  await sendMail({
    to: input.to,
    subject: `${input.profileName} mist je al 😉`,
    html: t.html,
    text: `${t.text}\n\nNieuw bericht van ${input.profileName}: ${input.preview}`,
  });
}

export async function sendAbandonmentOfferEmail(input: {
  to: string;
  naam: string;
  checkoutLink: string;
  subjectProfileName: string;
  subjectProfileAge: number;
  discountPercent: number;
}): Promise<void> {
  const nm = escapeHtml(input.naam || "daar");
  const checkoutHref = escapeHtml(input.checkoutLink);
  const subject = `${input.subjectProfileName} (${input.subjectProfileAge}) wacht op je...`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#ffffff; font-family:Arial, sans-serif; color:#111111;">
    <div style="max-width:620px; margin:0 auto; padding:44px 24px; font-size:18px; line-height:1.65;">

      <p>Hoi ${nm},</p>

      <p>Je was er bijna.</p>

      <p>Je had je e-mailadres al ingevuld.</p>

      <p>Maar je hebt je toegang nog niet afgerond...</p>

      <br>

      <p>Dat snappen we.</p>

      <p>Het kan spannend zijn om contact te leggen.</p>

      <p>Zeker als je niet precies weet wat je moet sturen.</p>

      <p>Of wie er aan de andere kant op je wacht...</p>

      <br>

      <p>Maar op dit moment zijn er een paar mannen die bij jouw profiel passen.</p>

      <p><strong>Lucas, 18</strong> wacht op je.</p>

      <p><strong>Daan, 18</strong> is online.</p>

      <p><strong>Mats, 20</strong> staat open voor een leuk gesprek.</p>

      <br>

      <p>Je hoeft geen perfecte openingszin te hebben.</p>

      <p>Een simpele hoi is vaak al genoeg.</p>

      <p>Een vraag.</p>

      <p>Een compliment.</p>

      <p>Of gewoon iets luchtigs...</p>

      <br>

      <p>Omdat je nog niet bent ingestapt, willen we je tijdelijk helpen.</p>

      <p>Alleen de komende <strong>24 uur</strong> krijg je <strong>${input.discountPercent}% korting</strong>.</p>

      <p>Zodat je alsnog rustig kunt ontdekken wie er op je wacht.</p>

      <br>

      <p>Ter vergelijking:</p>

      <p>Deze toegang kost je nu ongeveer hetzelfde als <strong>3 kopjes koffie</strong> bij een lokaal restaurant.</p>

      <p>Maar het kan wel het begin zijn van een spannend nieuw contact.</p>

      <br>

      <p>Wacht niet te lang.</p>

      <p>Je aanbieding blijft maar tijdelijk beschikbaar.</p>

      <p>En daarna verdwijnt deze korting automatisch.</p>

      <br>

      <p>
        <a href="${checkoutHref}" style="display:inline-block; background:#111827; color:#ffffff; text-decoration:none; padding:16px 24px; border-radius:4px; font-weight:bold;">
          Bekijk jouw aanbieding
        </a>
      </p>

      <br>

      <p>Veel plezier,</p>

      <p>Het team</p>

    </div>
  </body>
</html>`;

  const text = `Hoi ${input.naam || "daar"},

Je was er bijna en hebt je toegang nog niet afgerond.
Alleen de komende 24 uur: ${input.discountPercent}% korting.

Bekijk jouw aanbieding: ${input.checkoutLink}

Veel plezier,
Het team`;

  await sendMail({
    to: input.to,
    subject,
    html,
    text,
  });
}

export async function sendGiftReceivedEmail(input: {
  to: string;
  naam: string;
  profileName: string;
  credits: number;
  conversationId: string;
}): Promise<void> {
  const t = shellTemplate(
    `Cadeautje ontvangen van ${input.profileName} 🎁`,
    "Je hebt credits cadeau gekregen in een chat.",
    "Ga naar het gesprek",
    `${getSiteUrl()}/berichten?chat=${encodeURIComponent(input.conversationId)}`,
    `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">
      ${input.naam}, lekker bezig — <b>${input.profileName}</b> heeft je <b>${input.credits} credits</b> gestuurd.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;">
      Open snel de chat en maak het gesprek nog spannender.
    </p>`
  );
  await sendMail({
    to: input.to,
    subject: `Je hebt ${input.credits} credits cadeau gekregen 🎉`,
    html: t.html,
    text: `${t.text}\n\n${input.profileName} stuurde je ${input.credits} credits.`,
  });
}
