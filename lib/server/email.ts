const POSTMARK_URL = "https://api.postmarkapp.com/email";

const POSTMARK_SERVER_TOKEN =
  process.env.POSTMARK_SERVER_TOKEN ?? process.env.POSTMARK_API_TOKEN ?? "";
const POSTMARK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL ?? "info@discreetemeisjes.nl";
const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.discreetemeisjes.nl";

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

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
                    <td style="vertical-align:middle;">
                      <img src="${APP_URL}/logo-mark.png" alt="discreetemeisjes" width="50" height="50" style="display:block;width:50px;height:50px;border-radius:999px;" />
                    </td>
                    <td style="vertical-align:middle;padding-left:12px;">
                      <div style="font-size:30px;font-weight:800;line-height:1;color:#0f172a;">discreetemeisjes.nl</div>
                      <div style="margin-top:4px;font-size:12px;color:#6b7280;font-weight:600;">exclusieve ontmoetingen · discreet vertrouwen</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <div style="font-size:32px;font-weight:800;line-height:1.15;color:#0f172a;">${title}</div>
                <div style="margin-top:10px;font-size:19px;font-weight:600;color:#374151;">${subtitle}</div>
                <div style="margin-top:16px;height:3px;width:74px;background:#e20a62;border-radius:999px;"></div>
                <div style="margin-top:20px;">
                ${body}
                </div>
                <div style="margin-top:26px;">
                  <a href="${safeHref}" style="display:inline-block;background:#d10057;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:800;font-size:16px;">${ctaText}</a>
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
    // Postmark staat uit (testing): mail wordt niet verstuurd, geen error.
    console.info(
      `[email] Postmark uitgeschakeld — mail "${payload.subject}" naar ${payload.to} overgeslagen.`
    );
    return;
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
      From: POSTMARK_FROM_EMAIL,
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
    "Bevestig eerst je e-mailadres om discreetemeisjes te openen.",
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
    subject: "Bevestig je e-mail voor discreetemeisjes.nl",
    html: t.html,
    text: `${t.text}\n\nBevestig je e-mail: ${verifyUrl}`,
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
    subject: "Stel je wachtwoord opnieuw in — discreetemeisjes.nl",
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
    <blockquote style="margin:0;border-left:4px solid #f3d2df;padding:8px 12px;color:#4f3b66;background:#faf6fb;border-radius:8px;">
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
    "Je hebt gratis credits gekregen in een chat.",
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
