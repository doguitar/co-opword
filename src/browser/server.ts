import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deliverLink } from "../mail/magicLink.ts";
import { CrosswordRejected, DisplayNameTaken, MagicLinkRateLimited, openCoOpword, type PlayerSession } from "../product/coopword.ts";
import { openSnapshotStore } from "../storage/snapshotStore.ts";
import { librarySeed } from "./librarySeed.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../data");
try {
  process.loadEnvFile(join(dataDir, ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const port = Number(process.env.PORT ?? 3000);
const pagesDir = join(here, "pages");
const outboxPath = join(dataDir, "magic-link-outbox.jsonl");
const withdrawOutboxPath = join(dataDir, "withdraw-outbox.jsonl");
const stylesheet = readFileSync(join(pagesDir, "co-opword.css"));

const store = await openSnapshotStore(process.env.DATABASE_URL, dataDir);
const snapshot = await store.read();
let coOpword = snapshot === undefined ? openCoOpword() : openCoOpword(snapshot);

async function save(): Promise<void> {
  await store.write(coOpword.snapshot());
}

for (const crossword of librarySeed) {
  try {
    coOpword.admitLibraryCrossword(crossword);
  } catch (error) {
    if (!(error instanceof CrosswordRejected)) throw error;
  }
}
await save();

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

function frame(main: string): string {
  return fill(
    "controls/frame.html",
    {
      menu: fill("controls/menu.html"),
      masthead: fill("controls/masthead.html"),
      copyright: fill("controls/copyright.html"),
      main,
    },
    ["menu", "masthead", "copyright", "main"],
  );
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

const maxBodyBytes = 262144;

class BodyTooLargeError extends Error {}

async function limitedBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBodyBytes) throw new BodyTooLargeError();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function readBody(raw: Buffer): URLSearchParams {
  return new URLSearchParams(raw.toString("utf8"));
}

const securityHeaders = {
  "content-security-policy":
    "script-src 'self'; style-src 'self'; form-action 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

function rejectTooLarge(request: IncomingMessage, response: ServerResponse): void {
  const close = () => request.destroy();
  if (response.headersSent) {
    close();
    return;
  }
  response.writeHead(413, { "content-type": "text/html; charset=utf-8", connection: "close", ...securityHeaders });
  response.end(page(message("That request is too large.")), close);
}

function send(response: ServerResponse, status: number, main: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...securityHeaders, ...headers });
  response.end(page(main));
}

function message(text: string): string {
  return fill("message.html", { text });
}

function messageLink(text: string, href: string, label: string): string {
  return fill("message-link.html", { text, href, label });
}

function clues(words: { direction: string; length: number; clue: string }[]): string {
  return words.map((word) => fill("controls/clue.html", { direction: word.direction, length: String(word.length), clue: word.clue })).join("");
}

function clueColumns(words: { direction: string; length: number; clue: string }[]): string {
  const lines = (direction: string) => clues(words.filter((word) => word.direction === direction));
  return fill("controls/clue-columns.html", { across: lines("across"), down: lines("down") }, ["across", "down"]);
}

function libraryRows(squares: string[], size: number): string {
  const rows = [];
  for (let row = 0; row < size; row++) {
    const cells = squares.slice(row * size, (row + 1) * size).map((square) => {
      if (square === "#") return fill("controls/cell-block.html");
      return fill("controls/cell.html", { letter: square });
    });
    rows.push(fill("controls/row.html", { cells: cells.join("") }, ["cells"]));
  }
  return rows.join("");
}

const inkCount = 12;

function inkClass(index: number): string {
  return `ink-${((index % inkCount) + inkCount) % inkCount}`;
}

function clueStarts(words: { direction: string; row: number; column: number }[], size: number): Map<number, string> {
  const starts = new Set(words.map((word) => word.row * size + word.column));
  const numbers = new Map<number, string>();
  let number = 0;
  for (let index = 0; index < size * size; index++) {
    if (!starts.has(index)) continue;
    number += 1;
    numbers.set(index, String(number));
  }
  return numbers;
}

function wordCovers(word: { direction: string; row: number; column: number; length: number }, index: number, size: number): boolean {
  const row = Math.floor(index / size);
  const column = index % size;
  if (word.direction === "across") return word.row === row && column >= word.column && column < word.column + word.length;
  return word.column === column && row >= word.row && row < word.row + word.length;
}

function sessionRows(
  squares: { letter: string | null; present: string[]; block: boolean }[],
  size: number,
  numbers: Map<number, string>,
  players: { displayName: string | null }[],
  myIndex: number,
  rejected: number,
): string {
  const rows = [];
  for (let row = 0; row < size; row++) {
    const cells = squares.slice(row * size, (row + 1) * size).map((square, column) => {
      if (square.block) return fill("controls/cell-block.html");
      const index = row * size + column;
      const myName = myIndex >= 0 ? (players[myIndex]?.displayName ?? "") : "";
      const occupant = myName !== "" && square.present.includes(myName)
        ? myIndex
        : players.findIndex((player) => {
            const name = player.displayName ?? "";
            return name !== "" && square.present.includes(name);
          });
      const shade = occupant < 0 ? [] : occupant === myIndex ? ["selected", inkClass(occupant)] : [inkClass(occupant)];
      if (index === rejected) shade.push("reject");
      return fill("controls/cell-session.html", {
        shade: shade.join(" "),
        index: String(index),
        number: numbers.get(index) ?? "",
        letter: square.letter ?? "",
        focus: "",
      });
    });
    rows.push(fill("controls/row.html", { cells: cells.join("") }, ["cells"]));
  }
  return rows.join("");
}

function sessionClues(
  words: { direction: string; row: number; column: number; length: number; clue: string }[],
  size: number,
  selected: number,
  mark: string,
): string {
  const numbers = clueStarts(words, size);
  const ordered = [...words].sort((left, right) => Number(wordCovers(right, selected, size)) - Number(wordCovers(left, selected, size)));
  const lines = (direction: string) =>
    ordered
      .filter((word) => word.direction === direction)
      .map((word) =>
        fill("controls/session-clue.html", {
          mark: selected >= 0 && wordCovers(word, selected, size) ? mark : "",
          number: numbers.get(word.row * size + word.column) ?? "",
          clue: word.clue,
        }),
      )
      .join("");
  return fill("controls/clue-columns.html", { across: lines("across"), down: lines("down") }, ["across", "down"]);
}

function displayNameSentence(displayName: string | null): string {
  return displayName === null ? "You have not chosen a display name yet." : `Welcome back, ${displayName}`;
}

function displayNameForm(displayName: string | null, returnTo: string): string {
  return fill("controls/name-form.html", {
    displayName: displayName ?? "",
    submitLabel: displayName === null ? "Choose" : "Change display name",
    returnTo,
  });
}

function signedIn(session: PlayerSession): string | undefined {
  try {
    const me = coOpword.whoAmI(session);
    const open = coOpword.openSessions(session);
    const sessions =
      open.length === 0
        ? `<p>No open sessions. <a href="/published">Start one from a published crossword.</a></p>`
        : `<ul>${open
            .map(
              (live) =>
                `<li><a href="/session?invite=${encodeURIComponent(live.invite)}">${escapeHtml(live.title)}</a></li>`,
            )
            .join("")}</ul>`;
    const nameForm = me.displayName === null ? displayNameForm(null, "") : "";
    return fill(
      "home.html",
      {
        name: displayNameSentence(me.displayName),
        nameForm,
        sessions,
      },
      ["sessions", "nameForm"],
    );
  } catch {
    return undefined;
  }
}

function profilePage(session: PlayerSession): string | undefined {
  try {
    const me = coOpword.whoAmI(session);
    return fill(
      "profile.html",
      {
        name: displayNameSentence(me.displayName),
        nameForm: displayNameForm(me.displayName, "/profile"),
      },
      ["nameForm"],
    );
  } catch {
    return undefined;
  }
}

type BuiltWord = { direction: "across" | "down"; row: number; column: number; answer: string };

function normalizeSquare(value: string): string {
  const square = value.trim().toUpperCase();
  if (square === "#") return "#";
  if (/^[A-Z]$/.test(square)) return square;
  return "";
}

function readSquares(params: URLSearchParams, size: number): string[] {
  const posted = params.getAll("square").map(normalizeSquare);
  if (posted.length === size * size) return posted;
  const source = Math.round(Math.sqrt(posted.length));
  if (source * source !== posted.length || source < 9 || source > 21) {
    return Array.from({ length: size * size }, () => "");
  }
  const squares = Array.from({ length: size * size }, () => "");
  const span = Math.min(source, size);
  for (let row = 0; row < span; row++) {
    for (let column = 0; column < span; column++) {
      squares[row * size + column] = posted[row * source + column];
    }
  }
  return squares;
}

function wordsOn(squares: string[], size: number): BuiltWord[] {
  const words: BuiltWord[] = [];
  const white = (row: number, column: number) => squares[row * size + column] !== "#";
  for (let row = 0; row < size; row++) {
    let column = 0;
    while (column < size) {
      if (!white(row, column)) {
        column += 1;
        continue;
      }
      const start = column;
      let answer = "";
      let open = false;
      while (column < size && white(row, column)) {
        const letter = squares[row * size + column];
        if (letter === "") open = true;
        answer += letter;
        column += 1;
      }
      if (column - start >= 2) words.push({ direction: "across", row, column: start, answer: open ? "" : answer });
    }
  }
  for (let column = 0; column < size; column++) {
    let row = 0;
    while (row < size) {
      if (!white(row, column)) {
        row += 1;
        continue;
      }
      const start = row;
      let answer = "";
      let open = false;
      while (row < size && white(row, column)) {
        const letter = squares[row * size + column];
        if (letter === "") open = true;
        answer += letter;
        row += 1;
      }
      if (row - start >= 2) words.push({ direction: "down", row: start, column, answer: open ? "" : answer });
    }
  }
  return words;
}

function wordKey(word: BuiltWord): string {
  return `${word.direction}-${word.row}-${word.column}`;
}

function buildMain(fields: {
  title: string;
  author: string;
  kind: "standard" | "freestyle";
  size: number;
  squares: string[];
  words: BuiltWord[];
  clues: Map<string, string>;
  error: string;
  token: string;
  step: "grid" | "clues" | "edit";
}): string {
  const numbers = clueStarts(fields.words, fields.size);
  const rows = [];
  for (let row = 0; row < fields.size; row++) {
    const cells = fields.squares
      .slice(row * fields.size, (row + 1) * fields.size)
      .map((value, column) => {
        const index = row * fields.size + column;
        return fill(
          "controls/build-cell.html",
          {
            shade: value === "#" ? ' class="block"' : "",
            number: numbers.get(index) ?? "",
            value,
            place: `Row ${row + 1} column ${column + 1}`,
            extra: fields.step === "clues" ? " readonly" : "",
          },
          ["shade", "extra"],
        );
      })
      .join("");
    rows.push(fill("controls/row.html", { cells }, ["cells"]));
  }
  const grid = fill("controls/puzzle.html", { rows: rows.join("") }, ["rows"]);
  const editEmail = fields.token === "" ? fill("controls/edit-email.html") : "";
  const sizeField = `<label>Size <input name="size" type="number" min="9" max="21" value="${fields.size}" required></label>`;
  const editActions =
    `<button type="submit" name="intent" value="layout">Update grid</button>` +
    `<button type="submit" class="filled" name="intent" value="publish">Publish</button>`;
  let clues = "";
  if (fields.step === "grid") {
    clues = fields.words
      .map((word) => {
        const clue = fields.clues.get(wordKey(word)) ?? "";
        if (clue === "") return "";
        return fill("controls/build-preserved-clue.html", { word: wordKey(word), clue });
      })
      .join("");
  } else if (fields.step === "edit") {
    clues = fields.words
      .map((word) => {
        const clue = fields.clues.get(wordKey(word)) ?? "";
        const number = numbers.get(word.row * fields.size + word.column) ?? "";
        const direction = word.direction === "across" ? "Across" : "Down";
        return fill("controls/build-edit-clue.html", {
          label: `${number} ${direction}`,
          clue,
          word: wordKey(word),
        });
      })
      .join("");
  } else {
    const lines = (direction: "across" | "down") =>
      fields.words
        .filter((word) => word.direction === direction)
        .map((word) => {
          const number = numbers.get(word.row * fields.size + word.column) ?? "";
          const directionName = direction === "across" ? "Across" : "Down";
          return fill("controls/build-clue.html", {
            number,
            label: `${number} ${directionName}`,
            clue: fields.clues.get(wordKey(word)) ?? "",
            word: wordKey(word),
          });
        })
        .join("");
    clues = fill(
      "controls/clue-columns.html",
      { across: lines("across"), down: lines("down") },
      ["across", "down"],
    );
  }
  const content =
    fields.step === "edit"
      ? fill(
          "controls/build-edit.html",
          {
            title: fields.title,
            author: fields.author,
            freestyleSelected: fields.kind === "freestyle" ? "selected" : "",
            standardSelected: fields.kind === "standard" ? "selected" : "",
            sizeField,
            grid,
            clues,
            editEmail,
            error: fields.error,
            actions: editActions,
          },
          ["freestyleSelected", "standardSelected", "sizeField", "grid", "clues", "editEmail", "actions"],
        )
      : fill(
          "controls/build-stage.html",
          {
            grid,
            options:
              fields.step === "grid"
                ? fill("controls/build-options.html", {
                    title: fields.title,
                    author: fields.author,
                    size: String(fields.size),
                    freestyleSelected: fields.kind === "freestyle" ? "selected" : "",
                    standardSelected: fields.kind === "standard" ? "selected" : "",
                  })
                : fill("controls/build-hidden-options.html", {
                    title: fields.title,
                    author: fields.author,
                    kind: fields.kind,
                    size: String(fields.size),
                  }),
            rulesHidden: fields.kind === "standard" ? "" : "hidden",
            clues,
            editEmail,
            error: fields.error,
            actions: fill("controls/build-actions.html", {
              backHidden: fields.step === "grid" ? "hidden" : "",
              intent: fields.step === "grid" ? "clues" : "publish",
              label: fields.step === "grid" ? "Continue to clues" : "Publish",
            }),
          },
          ["grid", "options", "clues", "editEmail", "actions"],
        );
  return fill("build.html", { step: fields.step, token: fields.token, content }, ["content"]);
}

function reviseBuilder(
  opened: {
    title: string;
    author: string;
    kind: "standard" | "freestyle";
    size: number;
    squares: string[];
    words: { direction: "across" | "down"; row: number; column: number; clue: string }[];
    version: number;
  },
  token: string,
): string {
  const squares = opened.squares.map((square) => (square === "#" ? "#" : square));
  const words = wordsOn(squares, opened.size);
  const clues = new Map(opened.words.map((word) => [`${word.direction}-${word.row}-${word.column}`, word.clue]));
  return fill(
    "revise.html",
    {
      version: String(opened.version),
      token,
      form: buildMain({
        title: opened.title,
        author: opened.author,
        kind: opened.kind,
        size: opened.size,
        squares,
        words,
        clues,
        error: "",
        token,
        step: "edit",
      }),
    },
    ["form"],
  );
}

function readBuild(body: URLSearchParams): {
  title: string;
  author: string;
  kind: "standard" | "freestyle";
  size: number;
  squares: string[];
  words: BuiltWord[];
  clues: Map<string, string>;
  intent: string;
  token: string;
  editEmail: string;
} {
  const parsed = Number(body.get("size") ?? "");
  const size = Number.isInteger(parsed) && parsed >= 9 && parsed <= 21 ? parsed : 15;
  const kind = body.get("kind") === "standard" ? "standard" : "freestyle";
  const squares = readSquares(body, size);
  const words = wordsOn(squares, size);
  const clues = new Map<string, string>();
  const keys = body.getAll("word");
  const texts = body.getAll("clue");
  keys.forEach((key, index) => clues.set(key, texts[index] ?? ""));
  return {
    title: body.get("title") ?? "",
    author: body.get("author") ?? "",
    kind,
    size,
    squares,
    words,
    clues,
    intent: body.get("intent") ?? "",
    token: body.get("token") ?? "",
    editEmail: body.get("editEmail") ?? "",
  };
}

async function reviseNotice(email: string, token: string): Promise<string> {
  const href = `/revise?token=${encodeURIComponent(token)}`;
  const address = email.trim();
  const privateDelivery = process.env.NODE_ENV === "production" || Boolean(process.env.SMTP_USER || process.env.SMTP_PASSWORD);
  if (address === "") return messageLink("A Revise link is ready.", href, "Revise");
  try {
    const delivery = await deliverLink(withdrawOutboxPath, address, token, href, "Your Co-opword Revise link");
    return delivery === "smtp"
      ? message(`A Revise link was emailed to ${address}.`)
      : messageLink(`A Revise link was sent to ${address}.`, href, "Revise");
  } catch {
    const text = `The Crossword was published, but the Revise link could not be emailed to ${address}.`;
    return privateDelivery ? message(text) : messageLink(text, href, "Revise");
  }
}

type SessionStream = { response: ServerResponse; token: string; invite: string };

const streams = new Set<SessionStream>();
const grace = new Map<string, ReturnType<typeof setTimeout>>();
// A Session form POST drops this page's stream before the redirected page opens the next one.
const reconnectGraceMs = 1500;

function streamKey(token: string, invite: string): string {
  return `${token}\0${invite}`;
}

function publish(invite: string): void {
  for (const stream of streams) {
    if (stream.invite !== invite) continue;
    try {
      stream.response.write("event: session\ndata: refresh\n\n");
    } catch {
      streams.delete(stream);
    }
  }
}

function cancelGrace(token: string, invite: string): void {
  const pending = grace.get(streamKey(token, invite));
  if (!pending) return;
  clearTimeout(pending);
  grace.delete(streamKey(token, invite));
}

function dropStream(stream: SessionStream): void {
  if (!streams.delete(stream)) return;
  const key = streamKey(stream.token, stream.invite);
  if ([...streams].some((open) => streamKey(open.token, open.invite) === key)) return;
  const pending = grace.get(key);
  if (pending) clearTimeout(pending);
  grace.set(
    key,
    setTimeout(() => {
      grace.delete(key);
      if ([...streams].some((open) => streamKey(open.token, open.invite) === key)) return;
      try {
        coOpword.closeSession({ token: stream.token }, stream.invite);
      } catch {
        return;
      }
      void save().then(
        () => publish(stream.invite),
        () => {},
      );
    }, reconnectGraceMs),
  );
}

const server = createServer(async (request, response) => {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    rejectTooLarge(request, response);
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await limitedBody(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      rejectTooLarge(request, response);
      return;
    }
    throw error;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  coOpword.noteTime(Date.now());

  if (request.method === "GET" && url.pathname === "/co-opword.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8", ...securityHeaders });
    response.end(stylesheet);
    return;
  }

  if (request.method === "GET" && url.pathname === "/session.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders,
    });
    response.end(readFileSync(join(pagesDir, "session.js")));
    return;
  }

  if (request.method === "GET" && url.pathname === "/menu.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders,
    });
    response.end(readFileSync(join(pagesDir, "menu.js")));
    return;
  }

  if (request.method === "GET" && url.pathname === "/build.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders,
    });
    response.end(readFileSync(join(pagesDir, "build.js")));
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    const token = readCookie(request, "player");
    const home = token ? signedIn({ token }) : undefined;
    if (home) {
      send(response, 200, frame(home));
      return;
    }
    send(response, 200, frame(fill("sign-in.html")));
    return;
  }

  if (request.method === "POST" && url.pathname === "/sign-in") {
    const body = readBody(rawBody);
    const email = body.get("email") ?? "";
    let issued: { token: string; email: string };
    try {
      issued = coOpword.requestMagicLink(email);
    } catch (error) {
      if (error instanceof MagicLinkRateLimited) {
        send(response, 429, message(error.message), { "retry-after": String(error.retryAfterSeconds) });
        return;
      }
      throw error;
    }
    await save();
    const href = `/magic?token=${encodeURIComponent(issued.token)}`;
    try {
      const delivery = await deliverLink(outboxPath, issued.email, issued.token, href, "Sign in to Co-opword");
      if (delivery === "smtp") {
        send(response, 200, message("Check your email for a sign-in link."));
      } else {
        send(response, 200, messageLink(`A magic link was sent to ${issued.email}.`, href, "Open magic link"));
      }
    } catch {
      send(response, 503, message("We could not send the sign-in email. Please try again."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/magic") {
    const token = url.searchParams.get("token") ?? "";
    if (!coOpword.isMagicLinkValid(token)) {
      send(response, 400, message("That magic link is no longer valid."));
    } else {
      send(response, 200, frame(fill("magic-link-confirm.html", { token })));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/magic") {
    const expectedOrigin = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : url.origin;
    if (request.headers.origin !== expectedOrigin) {
      send(response, 403, message("That confirmation must come from Co-opword."));
      return;
    }
    const token = readBody(rawBody).get("token") ?? "";
    try {
      const session = coOpword.openMagicLink(token);
      await save();
      const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
      send(response, 303, message("Signed in."), {
        location: session.invite === null ? "/" : `/session?invite=${encodeURIComponent(session.invite)}`,
        "set-cookie": `player=${encodeURIComponent(session.token)}; HttpOnly; Path=/; SameSite=Lax${secure}`,
      });
    } catch {
      send(response, 400, message("That magic link is no longer valid."));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/sign-out") {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    send(response, 303, message("Signed out."), {
      location: "/",
      "set-cookie": `player=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax${secure}`,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/display-name") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = readBody(rawBody);
    const back = body.get("return") === "/profile" ? "/profile" : "/";
    try {
      coOpword.chooseDisplayName({ token }, body.get("displayName") ?? "");
      await save();
      send(response, 303, message("Saved."), { location: back });
    } catch (error) {
      if (error instanceof DisplayNameTaken) {
        send(response, 400, messageLink("That display name is already taken.", back, "Back"));
        return;
      }
      send(response, 400, message("Sign in again."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/profile") {
    const token = readCookie(request, "player");
    const profile = token ? profilePage({ token }) : undefined;
    if (!profile) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    send(response, 200, frame(profile));
    return;
  }

  if (request.method === "GET" && url.pathname === "/help") {
    send(response, 200, frame(fill("help.html")));
    return;
  }

  if (request.method === "GET" && (url.pathname === "/about" || url.pathname === "/support")) {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    send(response, 200, frame(fill(url.pathname === "/about" ? "about.html" : "support.html")));
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
          .map((crossword) => fill("controls/library-item.html", { href: `/crossword?title=${encodeURIComponent(crossword.title)}`, title: crossword.title }))
          .join("");
        send(response, 200, frame(fill("library.html", { items }, ["items"])));
        return;
      }
      const title = url.searchParams.get("title") ?? "";
      const author = url.searchParams.get("author");
      const opened = author === null
        ? coOpword.openLibraryCrossword(session, title)
        : coOpword.openPublishedCrossword(session, title, author);
      send(
        response,
        200,
        frame(
          fill(
            "crossword.html",
            {
              title: opened.title,
              rows: libraryRows(opened.squares, opened.size),
              clues: clueColumns(opened.words),
            },
            ["rows", "clues"],
          ),
        ),
      );
    } catch {
      send(response, 404, message(url.searchParams.has("author") ? "That Published Crossword is not available." : "That Crossword is not in the library."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/build") {
    const reviseToken = url.searchParams.get("token");
    if (reviseToken) {
      send(response, 303, message("Revise"), { location: `/revise?token=${encodeURIComponent(reviseToken)}` });
      return;
    }
    const token = readCookie(request, "player");
    if (!token || !signedIn({ token })) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const me = coOpword.whoAmI({ token });
    const size = 15;
    const squares = Array.from({ length: size * size }, () => "");
    send(
      response,
      200,
      frame(
        buildMain({
          title: "",
          author: me.displayName ?? "",
          kind: "freestyle",
          size,
          squares,
          words: wordsOn(squares, size),
          clues: new Map(),
          error: "",
          token: "",
          step: "grid",
        }),
      ),
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/build") {
    const built = readBuild(readBody(rawBody));
    const token = readCookie(request, "player");
    if (!built.token && (!token || !signedIn({ token }))) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const show = (error: string) =>
      send(
        response,
        200,
        frame(
          buildMain({
            ...built,
            error,
            step: built.token !== "" ? "edit" : built.intent === "clues" || built.intent === "publish" ? "clues" : "grid",
          }),
        ),
      );
    if (built.intent !== "publish") {
      show("");
      return;
    }
    const crossword = {
      title: built.title,
      kind: built.kind,
      size: built.size,
      squares: built.squares,
      words: built.words.map((word) => ({ ...word, clue: built.clues.get(wordKey(word)) ?? "" })),
    };
    if (built.token) {
      try {
        const version = coOpword.reviseCrossword(built.token, crossword, built.author);
        await save();
        const href = `/revise?token=${encodeURIComponent(built.token)}`;
        send(response, 200, messageLink(`That Crossword is now version ${version}.`, href, "Revise"));
      } catch {
        show("That Crossword cannot be published.");
      }
      return;
    }
    try {
      const issued = coOpword.publishCrossword(
        { token: token ?? "" },
        crossword,
        built.author,
      );
      await save();
      send(response, 200, await reviseNotice(built.editEmail, issued.withdrawToken));
    } catch (error) {
      const reason = error instanceof CrosswordRejected ? error.reason : null;
      show(reason ?? "That Crossword cannot be published.");
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
    send(response, 200, frame(fill("publish.html", { author: me.displayName ?? "" })));
    return;
  }

  if (request.method === "POST" && url.pathname === "/publish") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = readBody(rawBody);
    let issued;
    try {
      const crossword = JSON.parse(body.get("crossword") ?? "");
      issued = coOpword.publishCrossword({ token }, crossword, body.get("author") ?? "");
      await save();
      send(response, 200, await reviseNotice(body.get("editEmail") ?? "", issued.withdrawToken));
    } catch {
      send(response, 400, message("That Crossword cannot be published."));
      return;
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/withdraw") {
    const token = url.searchParams.get("token") ?? "";
    send(response, 303, message("Revise"), { location: `/revise?token=${encodeURIComponent(token)}` });
    return;
  }

  if (request.method === "GET" && url.pathname === "/revise") {
    try {
      const token = url.searchParams.get("token") ?? "";
      const opened = coOpword.openRevise(token);
      send(response, 200, frame(reviseBuilder(opened, token)));
    } catch {
      send(response, 404, message("That Revise link is no longer valid."));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/revise") {
    const body = readBody(rawBody);
    try {
      coOpword.withdrawCrossword(body.get("token") ?? "");
      await save();
      send(response, 200, message("That Crossword is off the public list. New Sessions cannot be started from it."));
    } catch {
      send(response, 400, message("That Revise link is no longer valid."));
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
        return fill(
          "controls/published-item.html",
          {
            title: crossword.title,
            titleValue: crossword.title,
            author: crossword.author === "" ? "no Author" : crossword.author,
            authorValue: crossword.author,
            previewHref: `/crossword?title=${encodeURIComponent(crossword.title)}&author=${encodeURIComponent(crossword.author)}`,
          },
          [],
        );
      })
      .join("");
    send(response, 200, frame(fill("published.html", { items }, ["items"])));
    return;
  }


  if (request.method === "POST" && url.pathname === "/session") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = readBody(rawBody);
    try {
      const author = body.get("author");
      const started = author === null ? coOpword.startSession({ token }, body.get("title") ?? "") : coOpword.startPublishedSession({ token }, body.get("title") ?? "", author);
      await save();
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
      await save();
      publish(invite);
      send(response, 303, message("Session"), { location: `/session?invite=${encodeURIComponent(invite)}` });
    } catch {
      send(response, 404, message("That Invite is no longer valid."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/session/events") {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 401, message("Sign in."));
      return;
    }
    const invite = url.searchParams.get("invite") ?? "";
    try {
      coOpword.openSession({ token }, invite);
    } catch {
      send(response, 404, message("That Invite is not yours."));
      return;
    }
    cancelGrace(token, invite);
    const stream: SessionStream = { response, token, invite };
    streams.add(stream);
    response.socket?.setNoDelay(true);
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      ...securityHeaders,
    });
    response.write("retry: 500\n: open\n\n");
    response.on("close", () => dropStream(stream));
    if (response.destroyed) dropStream(stream);
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
      const alertItems = coOpword
        .sessionAlerts({ token }, invite)
        .map((alert) => {
          const displayName = alert.displayName ?? "";
          const reply = alert.kind === "pending" ? fill("controls/decline.html", { invite: opened.invite, displayName }) : "";
          return fill("controls/alert.html", { displayName, kind: alert.kind, reply }, ["reply"]);
        })
        .join("");
      const alerts = alertItems === "" ? "" : fill("controls/alerts.html", { items: alertItems }, ["items"]);
      const me = coOpword.whoAmI({ token });
      const myIndex = opened.players.findIndex((player) => player.displayName === me.displayName);
      const selected = opened.squares.findIndex((square) => myIndex >= 0 && square.present.includes(me.displayName ?? ""));
      const rejectedParam = url.searchParams.get("reject");
      const rejected = rejectedParam === null || rejectedParam === "" ? -1 : Number(rejectedParam);
      const knownFriends = coOpword.friends({ token });
      const friendNames = new Set(knownFriends.map((friend) => friend.displayName));
      const friendInvites = knownFriends
        .filter((friend) => friend.displayName !== null && friend.email !== "")
        .map((friend) =>
          fill("controls/invite-friend.html", {
            invite: opened.invite,
            displayName: friend.displayName ?? "",
            email: friend.email,
          }),
        )
        .join("");
      const players = opened.players
        .map((player, index) => {
          const displayName = player.displayName ?? "";
          const bond = index === myIndex
            ? ""
            : friendNames.has(displayName)
              ? fill("controls/friend-heart.html")
              : fill("controls/friend-offer.html", { invite: opened.invite, displayName });
          return fill("controls/session-player.html", {
            ink: inkClass(index),
            displayName,
            letters: String(player.letters),
            bond,
          }, ["bond"]);
        })
        .join("");
      send(
        response,
        200,
        frame(
          fill(
            "session.html",
            {
              title: opened.title,
              invite: opened.invite,
              link,
              puzzle: fill("controls/puzzle.html", { rows: sessionRows(opened.squares, opened.size, clueStarts(opened.words, opened.size), opened.players, myIndex, rejected) }, ["rows"]),
              clues: sessionClues(opened.words, opened.size, selected, myIndex < 0 ? "" : `lit ${inkClass(myIndex)}`),
              playersSection: fill(
                "controls/player-status.html",
                { invite: opened.invite, link, players, alerts, friendInvites },
                ["players", "alerts", "friendInvites"],
              ),
              selected: selected < 0 ? "" : String(selected),
            },
            ["puzzle", "clues", "playersSection"],
          ),
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
    const body = readBody(rawBody);
    const invite = body.get("invite") ?? "";
    const index = Number(body.get("index"));
    const sessionPath = `/session?invite=${encodeURIComponent(invite)}`;
    try {
      if (url.pathname === "/session/select") coOpword.selectSquare({ token }, invite, index);
      else if (url.pathname === "/session/clear") coOpword.clearSquare({ token }, invite, index);
      else if (url.pathname === "/session/close") coOpword.closeSession({ token }, invite);
      else coOpword.typeLetter({ token }, invite, body.get("letter") ?? "");
      await save();
      publish(invite);
      let next = url.pathname === "/session/close" ? "/" : sessionPath;
      if (url.pathname === "/session/letter") {
        try {
          coOpword.openSession({ token }, invite);
        } catch {
          // typeLetter stays void; a Session it ended no longer opens.
          next = "/match";
        }
      }
      send(response, 303, message("Session"), { location: next });
    } catch {
      if (url.pathname === "/session/letter") {
        try {
          const opened = coOpword.openSession({ token }, invite);
          const me = coOpword.whoAmI({ token });
          const at = opened.squares.findIndex((square) => square.present.includes(me.displayName ?? ""));
          if (at >= 0) {
            send(response, 303, message("Session"), { location: `${sessionPath}&reject=${at}` });
            return;
          }
        } catch {
          // The Session cannot be opened, so the letter error page still applies.
        }
      }
      send(response, 400, messageLink("That Square did not take the letter.", sessionPath, "Back"));
    }
    return;
  }

  if (request.method === "POST" && (url.pathname === "/session/invite" || url.pathname === "/session/offer" || url.pathname === "/session/decline")) {
    const token = readCookie(request, "player");
    if (!token) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    const body = readBody(rawBody);
    const invite = body.get("invite") ?? "";
    try {
      if (url.pathname === "/session/invite") {
        const issued = coOpword.inviteEmail({ token }, invite, body.get("email") ?? "");
        const href = issued.token
          ? `/magic?token=${encodeURIComponent(issued.token)}`
          : `/session?invite=${encodeURIComponent(invite)}`;
        await save();
        publish(invite);
        try {
          await deliverLink(outboxPath, issued.email, issued.token, href, "Your Co-opword session invitation");
        } catch {
          send(
            response,
            503,
            messageLink("The Session invitation was created, but the email could not be sent.", `/session?invite=${encodeURIComponent(invite)}`, "Back to Session"),
          );
          return;
        }
      } else {
        if (url.pathname === "/session/decline") {
          coOpword.declineFriendship({ token }, invite, body.get("displayName") ?? "");
        } else {
          coOpword.offerFriendship({ token }, invite, body.get("displayName") ?? "");
        }
        await save();
        publish(invite);
      }
      send(response, 303, message("Session"), { location: `/session?invite=${encodeURIComponent(invite)}` });
    } catch {
      send(response, 400, message("That did not change the Session."));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/match") {
    const token = readCookie(request, "player");
    if (!token || !signedIn({ token })) {
      send(response, 303, message("Sign in."), { location: "/" });
      return;
    }
    send(response, 200, frame(messageLink("The Grid matched.", "/completions", "Completions")));
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
        const roster = completion.roster.map((entry) => fill("controls/roster.html", { displayName: entry.displayName ?? "", letters: String(entry.letters) })).join("");
        return fill(
          "controls/completion.html",
          { title: completion.title, author: completion.author === null ? "no Author" : completion.author, duration: String(completion.duration), roster },
          ["roster"],
        );
      })
      .join("");
    send(response, 200, frame(fill("completions.html", { items }, ["items"])));
    return;
  }

  send(response, 404, message("Not found."));
});

server.listen(port, () => {
  console.log(`Co-opword listening on http://localhost:${port}`);
});
