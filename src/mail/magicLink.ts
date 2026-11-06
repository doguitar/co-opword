import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function deliverLink(
  outboxPath: string,
  email: string,
  token: string | null,
  href: string,
): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    const originValue = process.env.PUBLIC_ORIGIN;
    if (!apiKey || !from || !originValue) throw new Error("RESEND_API_KEY, EMAIL_FROM, and PUBLIC_ORIGIN are required");

    const origin = new URL(originValue);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
      throw new Error("PUBLIC_ORIGIN must be an HTTPS origin");
    }
    const link = new URL(href, origin).href;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your Co-opword link",
        text: `Open this Co-opword link: ${link}`,
      }),
    });
    if (!response.ok) throw new Error(`Resend rejected email (${response.status})`);
    return;
  }

  mkdirSync(dirname(outboxPath), { recursive: true });
  appendFileSync(outboxPath, `${JSON.stringify({ email, token })}\n`);
}
