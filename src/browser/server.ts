import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deliverMagicLink } from "../mail/magicLink.ts";
import { DisplayNameTaken, openCoOpword, type PlayerSession } from "../product/coopword.ts";
import { readSnapshot, writeSnapshot } from "../storage/fileSnapshot.ts";

const port = Number(process.env.PORT ?? 3000);
const statePath = join(dirname(fileURLToPath(import.meta.url)), "../../data/coopword.json");

const saved = readSnapshot(statePath);
let coOpword = saved === undefined ? openCoOpword() : openCoOpword(saved);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Co-opword</title>
<body>
${html}
</body>
</html>`);
}

function signedIn(session: PlayerSession): string | undefined {
  try {
    const me = coOpword.whoAmI(session);
    const name = me.displayName === null ? "You have not chosen a display name yet." : escapeHtml(me.displayName);
    const others = coOpword
      .playersOthersSee(session)
      .map((player) => `<li>${escapeHtml(player.displayName)}</li>`)
      .join("");
    return `<p>${name}</p>
<form method="post" action="/display-name">
  <label>Display name <input name="displayName" required></label>
  <button type="submit">${me.displayName === null ? "Choose" : "Rename"}</button>
</form>
<h2>Other players</h2>
<ul>${others}</ul>`;
  } catch {
    return undefined;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    const token = readCookie(request, "player");
    const home = token ? signedIn({ token }) : undefined;
    if (home) {
      send(response, 200, home);
      return;
    }
    send(
      response,
      200,
      `<form method="post" action="/sign-in">
        <label>Email <input name="email" type="email" required></label>
        <button type="submit">Email me a magic link</button>
      </form>`,
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/sign-in") {
    const body = await readBody(request);
    const email = body.get("email") ?? "";
    const link = coOpword.requestMagicLink(email);
    writeSnapshot(statePath, coOpword.snapshot());
    const mail = deliverMagicLink(email, link.token);
    send(
      response,
      200,
      `<p>A magic link for ${escapeHtml(mail.email)} is ready.</p><p><a href="${escapeHtml(mail.openPath)}">Open magic link</a></p>`,
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/magic") {
    try {
      const session = coOpword.openMagicLink(url.searchParams.get("token") ?? "");
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 303, `<p>Signed in.</p>`, {
        location: "/",
        "set-cookie": `player=${encodeURIComponent(session.token)}; HttpOnly; Path=/; SameSite=Lax`,
      });
    } catch {
      send(response, 400, `<p>That magic link is no longer valid.</p>`);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/display-name") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, `<p>Sign in.</p>`, { location: "/" });
      return;
    }
    const body = await readBody(request);
    try {
      coOpword.chooseDisplayName({ token }, body.get("displayName") ?? "");
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 303, `<p>Saved.</p>`, { location: "/" });
    } catch (error) {
      if (error instanceof DisplayNameTaken) {
        send(response, 400, `<p>That display name is already taken.</p><p><a href="/">Back</a></p>`);
        return;
      }
      send(response, 400, `<p>Sign in again.</p>`);
    }
    return;
  }

  send(response, 404, `<p>Not found.</p>`);
});

server.listen(port, () => {
  console.log(`Co-opword listening on http://localhost:${port}`);
});
