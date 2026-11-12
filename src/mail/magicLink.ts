import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import nodemailer from "nodemailer";

export async function deliverLink(
  outboxPath: string,
  email: string,
  token: string | null,
  path: string,
  subject = "Your Co-opword link",
): Promise<"outbox" | "smtp"> {
  const { SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_USER && !SMTP_PASSWORD) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_USER and SMTP_PASSWORD are required");
    mkdirSync(dirname(outboxPath), { recursive: true });
    appendFileSync(outboxPath, `${JSON.stringify({ email, token })}\n`);
    return "outbox";
  }
  if (!SMTP_USER || !SMTP_PASSWORD) throw new Error("SMTP_USER and SMTP_PASSWORD must both be configured");

  const mail = inspectMailConfiguration();
  if (mail.missing.length > 0) {
    const message = mail.missing.includes("PUBLIC_URL")
      ? "PUBLIC_URL is required for email delivery"
      : "SMTP_USER and SMTP_PASSWORD must both be configured";
    throw new Error(message);
  }
  if (mail.invalid.length > 0) {
    const key = mail.invalid[0];
    throw new Error(
      key === "PUBLIC_URL"
        ? "PUBLIC_URL must be an HTTPS origin"
        : key === "SMTP_PORT"
          ? "SMTP_PORT must be a valid port"
          : "SMTP_SECURE must be true or false",
    );
  }
  const settings = mail.settings;
  if (!settings) throw new Error("Mail configuration is unavailable");
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
  });
  const href = new URL(path, settings.origin).href;
  const html = `
    <div style="display:none;max-height:0;overflow:hidden">Use this Co-opword link to continue.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 12px;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #cccccc">
          <tr><td style="padding:16px 24px;border-bottom:1px solid #cccccc;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;letter-spacing:2px">CO-OPWORD</td></tr>
          <tr><td style="padding:32px 24px">
            <p style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#555555">Your link</p>
            <h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;font-weight:normal">${escapeHtml(subject)}</h1>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.5">Use this link to continue in Co-opword.</p>
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background-color:#1a1a1a">
              <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold">Continue to Co-opword</a>
            </td></tr></table>
            <p style="margin:24px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#555555">If you weren't expecting this email, you can ignore it.</p>
          </td></tr>
          <tr><td style="padding:12px 24px;border-top:1px solid #cccccc;font-family:Arial,sans-serif;font-size:11px;letter-spacing:1px;color:#555555">A shared crossword, together.</td></tr>
        </table>
      </td></tr>
    </table>`;
  await transport.sendMail({
    from: settings.from,
    to: email,
    subject,
    text: `${subject}\n\nContinue to Co-opword: ${href}\n\nIf you weren't expecting this email, you can ignore it.`,
    html,
  });
  return "smtp";
}

export function inspectMailConfiguration(): {
  settings?: {
    user: string;
    password: string;
    origin: URL;
    host: string;
    port: number;
    secure: boolean;
    from: string;
  };
  missing: string[];
  invalid: string[];
} {
  const missing: string[] = [];
  const invalid: string[] = [];
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl?.trim()) missing.push("PUBLIC_URL");
  if (!SMTP_USER?.trim()) missing.push("SMTP_USER");
  if (!SMTP_PASSWORD?.trim()) missing.push("SMTP_PASSWORD");
  if (missing.length > 0) return { missing, invalid };

  let origin: URL | undefined;
  try {
    origin = new URL(publicUrl!);
    if (
      origin.protocol !== "https:" ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      invalid.push("PUBLIC_URL");
    }
  } catch {
    invalid.push("PUBLIC_URL");
  }
  const port = Number(process.env.SMTP_PORT ?? 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid.push("SMTP_PORT");
  const secureValue = process.env.SMTP_SECURE;
  if (secureValue !== undefined && secureValue !== "true" && secureValue !== "false") {
    invalid.push("SMTP_SECURE");
  }
  if (invalid.length > 0) return { missing, invalid };
  return {
    missing,
    invalid,
    settings: {
      user: SMTP_USER!,
      password: SMTP_PASSWORD!,
      origin: origin!,
      host: process.env.SMTP_HOST ?? "smtp.purelymail.com",
      port,
      secure: secureValue === undefined ? port === 465 : secureValue === "true",
      from: process.env.MAIL_FROM ?? "donotreply@updo.gg",
    },
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
