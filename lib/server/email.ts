const POSTMARK_URL = "https://api.postmarkapp.com/email";

const POSTMARK_SERVER_TOKEN =
  process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN ?? "";
/** Vast afzenderadres voor alle Postmark-transactional mail. */
export const POSTMARK_FROM_EMAIL = "info@stiekemefotos.nl";
const POSTMARK_FROM_HEADER = `Stiekemefotos <${POSTMARK_FROM_EMAIL}>`;
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.stiekemefotos.nl";

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
  const ctaUrl = `${APP_URL}/profielen?utm_source=email&utm_medium=daily&utm_campaign=new-women`;
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
  const safeHref = ctaHref.startsWith("http") ? ctaHref : APP_URL;
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
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${encodeURIComponent(input.verifyToken)}`;
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
  const loginHref = input.loginLink.startsWith("http") ? input.loginLink : `${APP_URL}${input.loginLink}`;
  const loginAnchor = `<a href="${escapeHtml(loginHref)}" style="color:#111111;font-weight:700;">${escapeHtml(loginHref)}</a>`;
  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#ffffff; font-family:Arial, sans-serif; color:#111111;">
    <div style="max-width:620px; margin:0 auto; padding:44px 24px; font-size:18px; line-height:1.65;">

      <p>Hoi ${nm},</p>

      <p>Gefeliciteerd.</p>

      <p>Je bent toegelaten.</p>

      <p>Je toegang tot het platform staat vanaf nu klaar...</p>

      <br>

      <p>Niet iedereen komt hier zomaar binnen.</p>

      <p>We laten bewust maar een kleine groep mensen toe.</p>

      <p>Zodat de gesprekken persoonlijk blijven.</p>

      <p>Spannend blijven.</p>

      <p>En vooral echt blijven...</p>

      <br>

      <p>Vanaf nu kun je contact maken met jongere mannen die zin hebben in een leuk gesprek.</p>

      <p>Mannen die nieuwsgierig zijn.</p>

      <p>Die openstaan voor contact.</p>

      <p>En die willen ontdekken wie jij bent...</p>

      <br>

      <p>Je hoeft geen perfect eerste bericht te sturen.</p>

      <p>Je hoeft niet lang na te denken.</p>

      <p>Je hoeft alleen maar iemand te kiezen die je aanspreekt.</p>

      <p>En iets simpels te sturen...</p>

      <br>

      <p>Een hoi.</p>

      <p>Een vraag.</p>

      <p>Een opmerking.</p>

      <p>Dat is vaak genoeg om iets leuks te starten...</p>

      <br>

      <p>De meeste mensen kijken alleen rond.</p>

      <p>Ze wachten.</p>

      <p>Ze twijfelen.</p>

      <p>Ze stellen het uit.</p>

      <p>Maar daardoor gebeurt er niets...</p>

      <br>

      <p>Jij hebt nu toegang.</p>

      <p>Dus gebruik hem.</p>

      <p>Log in.</p>

      <p>Kijk wie er online is.</p>

      <p>En start je eerste gesprek...</p>

      <br>

      <p>${loginAnchor}</p>

      <br>

      <p>Veel plezier,</p>

      <p>Het team</p>

    </div>
  </body>
</html>`;
  const text = `Hoi ${input.naam || "daar"},

Gefeliciteerd. Je bent toegelaten.

Je toegang tot het platform staat vanaf nu klaar.

Log in en start je eerste gesprek:
${loginHref}

Veel plezier,
Het team`;

  await sendMail({
    to: input.to,
    subject: "Je bent toegelaten — stiekemefotos.nl",
    html,
    text,
  });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  naam: string;
  resetToken: string;
}): Promise<void> {
  const resetUrl = `${APP_URL}/wachtwoord-reset?token=${encodeURIComponent(input.resetToken)}`;
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
    `${APP_URL}/berichten?chat=${encodeURIComponent(input.conversationId)}`,
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
    `${APP_URL}/berichten?chat=${encodeURIComponent(input.conversationId)}`,
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
