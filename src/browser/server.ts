import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deliverLink } from "../mail/magicLink.ts";
import { CrosswordRejected, DisplayNameTaken, openCoOpword, type PlayerSession } from "../product/coopword.ts";
import { librarySeed } from "./librarySeed.ts";
import { readSnapshot, writeSnapshot } from "../storage/fileSnapshot.ts";

const port = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../data");
const pagesDir = join(here, "pages");
const statePath = join(dataDir, "coopword.json");
const outboxPath = join(dataDir, "magic-link-outbox.jsonl");
const withdrawOutboxPath = join(dataDir, "withdraw-outbox.jsonl");
const stylesheet = readFileSync(join(pagesDir, "co-opword.css"));

const snapshot = readSnapshot(statePath);
let coOpword = snapshot === undefined ? openCoOpword() : openCoOpword(snapshot);

for (const crossword of librarySeed) {
  try {
    coOpword.admitLibraryCrossword(crossword);
  } catch (error) {
    if (!(error instanceof CrosswordRejected)) throw error;
  }
}
writeSnapshot(statePath, coOpword.snapshot());

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fill(name: string, slots: Record<string, string> = {}, raw: string[] = []): string {
  const template = readFileSync(join(pagesDir, name), "utf8");
  return template.replaceAll(/\{\{([a-zA-Z0-9]+)\}\}/g, (_, key: string) => {
    const value = slots[key] ?? "";
    return raw.includes(key) ? value : escapeHtml(value);
  });
}

function page(main: string): string {
  return fill("document.html", { main }, ["main"]);
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

function send(response: ServerResponse, status: number, main: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(page(main));
}

function message(text: string): string {
  return fill("message.html", { text });
}

function messageLink(text: string, href: string, label: string): string {
  return fill("message-link.html", { text, href, label });
}

function clues(words: { direction: string; length: number; clue: string }[]): string {
  return words.map((word) => fill("clue.html", { direction: word.direction, length: String(word.length), clue: word.clue })).join("");
}

function libraryRows(squares: string[], size: number): string {
  const rows = [];
  for (let row = 0; row < size; row++) {
    const cells = squares.slice(row * size, (row + 1) * size).map((square) => {
      if (square === "#") return fill("cell-block.html");
      return fill("cell.html", { letter: square });
    });
    rows.push(fill("row.html", { cells: cells.join("") }, ["cells"]));
  }
  return rows.join("");
}

function sessionRows(squares: { letter: string | null; present: string[]; block: boolean }[], size: number): string {
  const rows = [];
  for (let row = 0; row < size; row++) {
    const cells = squares.slice(row * size, (row + 1) * size).map((square) => {
      if (square.block) return fill("cell-block.html");
      const names = square.present.filter((name) => name !== "").join(", ");
      if (names === "") return fill("cell.html", { letter: square.letter ?? "" });
      return fill("cell-present.html", { letter: square.letter ?? "", names });
    });
    rows.push(fill("row.html", { cells: cells.join("") }, ["cells"]));
  }
  return rows.join("");
}

function signedIn(session: PlayerSession): string | undefined {
  try {
    const me = coOpword.whoAmI(session);
    const players = coOpword.playersOthersSee(session).map((player) => fill("player.html", { displayName: player.displayName })).join("");
    return fill(
      "home.html",
      {
        name: me.displayName === null ? "You have not chosen a display name yet." : me.displayName,
        action: me.displayName === null ? "Choose" : "Rename",
        players,
      },
      ["players"],
    );
  } catch {
    return undefined;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  coOpword.noteTime(Date.now());

  if (request.method === "GET" && url.pathname === "/co-opword.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(stylesheet);
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    const token = readCookie(request, "player");
    const home = token ? signedIn({ token }) : undefined;
    if (home) {
      send(response, 200, home);
      return;
    }
    send(response, 200, fill("sign-in.html"));
    return;
  }

  if (request.method === "POST" && url.pathname === "/sign-in") {
    const body = await readBody(request);
    const email = body.get("email") ?? "";
    const issued = coOpword.requestMagicLink(email);
    writeSnapshot(statePath, coOpword.snapshot());
    deliverLink(outboxPath, issued.email, issued.token);
    const href = `/magic?token=${encodeURIComponent(issued.token)}`;
    send(response, 200, messageLink(`A magic link was sent to ${issued.email}.`, href, "Open magic link"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/magic") {
    try {
      const session = coOpword.openMagicLink(url.searchParams.get("token") ?? "");
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 303, message("Signed in."), {
        location: session.invite === null ? "/" : `/session?invite=${encodeURIComponent(session.invite)}`,
        "set-cookie": `player=${encodeURIComponent(session.token)}; HttpOnly; Path=/; SameSite=Lax`,
      });
    } catch {
      send(response, 400, message("That magic link is no longer valid."));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/display-name") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = await readBody(request);
    try {
      coOpword.chooseDisplayName({ token }, body.get("displayName") ?? "");
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 303, message("Saved."), { location: "/" });
    } catch (error) {
      if (error instanceof DisplayNameTaken) {
        send(response, 400, messageLink("That display name is already taken.", "/", "Back"));
        return;
      }
      send(response, 400, message("Sign in again."));
    }
    return;
  }

  if (request.method === "GET" && (url.pathname === "/library" || url.pathname === "/crossword")) {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const session = { token };
    try {
      if (url.pathname === "/library") {
        const items = coOpword
          .library(session)
          .map((crossword) => fill("library-item.html", { href: `/crossword?title=${encodeURIComponent(crossword.title)}`, title: crossword.title }))
          .join("");
        send(response, 200, fill("library.html", { items }, ["items"]));
        return;
      }
      const opened = coOpword.openLibraryCrossword(session, url.searchParams.get("title") ?? "");
      send(
        response,
        200,
        fill(
          "crossword.html",
          { title: opened.title, rows: libraryRows(opened.squares, opened.size), clues: clues(opened.words) },
          ["rows", "clues"],
        ),
      );
    } catch {
      send(response, 404, message("That Crossword is not in the library."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/publish") {
    const token = readCookie(request, "player");
    if (!token || !signedIn({ token })) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const me = coOpword.whoAmI({ token });
    send(response, 200, fill("publish.html", { author: me.displayName ?? "" }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/publish") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = await readBody(request);
    try {
      const crossword = JSON.parse(body.get("crossword") ?? "");
      const issued = coOpword.publishCrossword({ token }, crossword, body.get("author") ?? "");
      writeSnapshot(statePath, coOpword.snapshot());
      deliverLink(withdrawOutboxPath, issued.email, issued.withdrawToken);
      const href = `/withdraw?token=${encodeURIComponent(issued.withdrawToken)}`;
      send(response, 200, messageLink(`A Withdraw link was sent to ${issued.email}.`, href, "Withdraw"));
    } catch {
      send(response, 400, message("That Crossword cannot be published."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/withdraw") {
    try {
      coOpword.withdrawCrossword(url.searchParams.get("token") ?? "");
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 200, message("That Crossword is off the public list."));
    } catch {
      send(response, 400, message("That Withdraw link can only take a Crossword off the public list."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/published") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const items = coOpword
      .published({ token })
      .map((crossword) => {
        const href = `/published-crossword?title=${encodeURIComponent(crossword.title)}&author=${encodeURIComponent(crossword.author)}`;
        return fill("published-item.html", { href, title: crossword.title, author: crossword.author === "" ? "no Author" : crossword.author });
      })
      .join("");
    send(response, 200, fill("published.html", { items }, ["items"]));
    return;
  }

  if (request.method === "GET" && url.pathname === "/published-crossword") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    try {
      const opened = coOpword.openPublishedCrossword({ token }, url.searchParams.get("title") ?? "", url.searchParams.get("author") ?? "");
      send(
        response,
        200,
        fill("published-crossword.html", {
          title: opened.title,
          author: opened.author === "" ? "no Author" : opened.author,
          authorValue: opened.author,
          words: String(opened.words.length),
        }),
      );
    } catch {
      send(response, 404, message("That Crossword is not published."));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/session") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = await readBody(request);
    try {
      const author = body.get("author");
      const started = author === null ? coOpword.startSession({ token }, body.get("title") ?? "") : coOpword.startPublishedSession({ token }, body.get("title") ?? "", author);
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 303, message("Session"), { location: `/session?invite=${encodeURIComponent(started.invite)}` });
    } catch {
      send(response, 404, message("That Crossword is not in the library."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/join") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const invite = url.searchParams.get("invite") ?? "";
    try {
      coOpword.joinSession({ token }, invite);
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 303, message("Session"), { location: `/session?invite=${encodeURIComponent(invite)}` });
    } catch {
      send(response, 404, message("That Invite is no longer valid."));
    }
    return;
  }

  if (url.pathname === "/session" && request.method === "GET") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const invite = url.searchParams.get("invite") ?? "";
    try {
      const opened = coOpword.openSession({ token }, invite);
      const link = `/join?invite=${encodeURIComponent(opened.invite)}`;
      const alerts = coOpword.sessionAlerts({ token }, invite).map((alert) => fill("alert.html", { displayName: alert.displayName ?? "", kind: alert.kind })).join("");
      send(
        response,
        200,
        fill(
          "session.html",
          {
            title: opened.title,
            invite: opened.invite,
            link,
            rows: sessionRows(opened.squares, opened.size),
            clues: clues(opened.words),
            alerts,
          },
          ["rows", "clues", "alerts"],
        ),
      );
    } catch {
      send(response, 404, message("That Invite is not yours."));
    }
    return;
  }

  if (request.method === "POST" && (url.pathname === "/session/letter" || url.pathname === "/session/select" || url.pathname === "/session/clear" || url.pathname === "/session/close")) {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = await readBody(request);
    const invite = body.get("invite") ?? "";
    const index = Number(body.get("index"));
    try {
      if (url.pathname === "/session/select") coOpword.selectSquare({ token }, invite, index);
      else if (url.pathname === "/session/clear") coOpword.clearSquare({ token }, invite, index);
      else if (url.pathname === "/session/close") coOpword.closeSession({ token }, invite);
      else coOpword.typeLetter({ token }, invite, body.get("letter") ?? "");
      writeSnapshot(statePath, coOpword.snapshot());
      const next = url.pathname === "/session/close" ? "/" : `/session?invite=${encodeURIComponent(invite)}`;
      send(response, 303, message("Session"), { location: next });
    } catch {
      send(response, 400, message("That Square did not take the letter."));
    }
    return;
  }

  if (request.method === "POST" && (url.pathname === "/session/invite" || url.pathname === "/session/offer" || url.pathname === "/session/decline")) {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = await readBody(request);
    const invite = body.get("invite") ?? "";
    try {
      if (url.pathname === "/session/invite") {
        const issued = coOpword.inviteEmail({ token }, invite, body.get("email") ?? "");
        if (issued.token) deliverLink(outboxPath, issued.email, issued.token);
      } else if (url.pathname === "/session/decline") {
        coOpword.declineFriendship({ token }, invite, body.get("displayName") ?? "");
      } else {
        coOpword.offerFriendship({ token }, invite, body.get("displayName") ?? "");
      }
      writeSnapshot(statePath, coOpword.snapshot());
      send(response, 303, message("Session"), { location: `/session?invite=${encodeURIComponent(invite)}` });
    } catch {
      send(response, 400, message("That did not change the Session."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/completions") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const items = coOpword
      .completions({ token })
      .map((completion) => {
        const roster = completion.roster.map((entry) => fill("roster.html", { displayName: entry.displayName ?? "", letters: String(entry.letters) })).join("");
        return fill(
          "completion.html",
          { title: completion.title, author: completion.author === null ? "no Author" : completion.author, duration: String(completion.duration), roster },
          ["roster"],
        );
      })
      .join("");
    send(response, 200, fill("completions.html", { items }, ["items"]));
    return;
  }

  send(response, 404, message("Not found."));
});

server.listen(port, () => {
  console.log(`Co-opword listening on http://localhost:${port}`);
});
