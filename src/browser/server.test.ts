import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("no port"));
      });
    });
  });
}

async function startServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/browser/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const deadline = Date.now() + 5000;
  while (!output.includes("Co-opword listening")) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(output || "server did not listen");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return child;
}

type Reply = { status: number; body: string; location: string | null; cookie: string | null };

async function send(port: number, method: string, path: string, cookie: string | null, body?: Record<string, string>): Promise<Reply> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
    redirect: "manual",
  });
  const setCookie = response.headers.getSetCookie().find((entry) => entry.startsWith("player="));
  return {
    status: response.status,
    body: await response.text(),
    location: response.headers.get("location"),
    cookie: setCookie ? setCookie.split(";")[0] : null,
  };
}

function rejection(body: string, invite: string): void {
  const href = `/session?invite=${encodeURIComponent(invite)}`;
  assert.match(body, /That Square did not take the letter\./);
  assert.deepEqual(
    [...body.matchAll(/<a href="([^"]*)">/g)].map((match) => match[1]),
    [href],
  );
}

test("a rejected letter leaves the Locked letter and links back to that Session", async () => {
  const port = await freePort();
  const child = await startServer(port);
  const sessionPath = (invite: string) => `/session?invite=${encodeURIComponent(invite)}`;
  try {
    const displayName = `Ada${Date.now()}`;
    const sent = await send(port, "POST", "/sign-in", null, { email: `ada${Date.now()}@example.com` });
    const magic = sent.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const signed = await send(port, "GET", magic, null);
    const cookie = signed.cookie;
    assert.ok(cookie);
    await send(port, "POST", "/display-name", cookie, { displayName });
    const started = await send(port, "POST", "/session", cookie, { title: "First Row" });
    const invite = new URL(started.location ?? "", "http://localhost").searchParams.get("invite") ?? "";
    assert.equal(started.status, 303);
    assert.equal(started.location, sessionPath(invite));

    const opened = await send(port, "GET", sessionPath(invite), cookie);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.includes("That Square did not take the letter."), false);
    assert.match(opened.body, /<h1>First Row<\/h1>/);
    assert.match(opened.body, /Nine As/);
    const idle = await send(port, "POST", "/session/letter", cookie, { invite, letter: "Z" });
    assert.equal(idle.status, 303);
    assert.equal(idle.location, sessionPath(invite));
    const unselected = await send(port, "GET", sessionPath(invite), cookie);
    assert.equal(unselected.body.includes("<td>Z"), false);
    assert.equal(unselected.body.includes("That Square did not take the letter."), false);

    const selected = await send(port, "POST", "/session/select", cookie, { invite, index: "0" });
    assert.equal(selected.status, 303);
    assert.equal(selected.location, sessionPath(invite));
    const typed = await send(port, "POST", "/session/letter", cookie, { invite, index: "0", letter: "b" });
    assert.equal(typed.status, 303);
    assert.equal(typed.location, sessionPath(invite));
    const locked = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(locked.body, new RegExp(`<td>B<br>${displayName}</td>`));
    assert.equal(locked.body.includes("That Square did not take the letter."), false);

    const rejected = await send(port, "POST", "/session/letter", cookie, { invite, index: "0", letter: "C" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.location, null);
    rejection(rejected.body, invite);
    const back = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(back.body, new RegExp(`<td>B<br>${displayName}</td>`));
    assert.equal(back.body.includes("That Square did not take the letter."), false);
    assert.match(back.body, /Nine As/);

    const next = await send(port, "POST", "/session/select", cookie, { invite, index: "1" });
    assert.equal(next.status, 303);
    await send(port, "POST", "/session/letter", cookie, { invite, index: "1", letter: "A" });
    const same = await send(port, "POST", "/session/letter", cookie, { invite, index: "1", letter: "A" });
    assert.equal(same.status, 400);
    rejection(same.body, invite);
    const notLetter = await send(port, "POST", "/session/letter", cookie, { invite, index: "1", letter: "!" });
    assert.equal(notLetter.status, 400);
    rejection(notLetter.body, invite);
    const kept = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(kept.body, /<td>B<\/td>/);
    assert.match(kept.body, new RegExp(`<td>A<br>${displayName}</td>`));
    assert.equal(kept.body.includes("<td>!"), false);

    const closed = await send(port, "POST", "/session/close", cookie, { invite });
    assert.equal(closed.status, 303);
    assert.equal(closed.location, "/");
    const reopened = await send(port, "GET", sessionPath(invite), cookie);
    assert.equal(reopened.status, 200);
    assert.match(reopened.body, /<td>B<\/td>/);
    assert.match(reopened.body, /<td>A<\/td>/);
    assert.equal(reopened.body.includes("That Square did not take the letter."), false);

    const cleared = await send(port, "POST", "/session/clear", cookie, { invite, index: "0" });
    assert.equal(cleared.status, 303);
    await send(port, "POST", "/session/select", cookie, { invite, index: "0" });
    const retyped = await send(port, "POST", "/session/letter", cookie, { invite, index: "0", letter: "Q" });
    assert.equal(retyped.status, 303);
    const replaced = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(replaced.body, new RegExp(`<td>Q<br>${displayName}</td>`));
    assert.equal(replaced.body.includes("<td>B"), false);
    assert.equal(replaced.body.includes("That Square did not take the letter."), false);

    const block = await send(port, "POST", "/session/select", cookie, { invite, index: "9" });
    assert.equal(block.status, 400);
    rejection(block.body, invite);
    const blockedClear = await send(port, "POST", "/session/clear", cookie, { invite, index: "9" });
    assert.equal(blockedClear.status, 400);
    rejection(blockedClear.body, invite);
    const blockedClose = await send(port, "POST", "/session/close", cookie, { invite: "nope" });
    assert.equal(blockedClose.status, 400);
    rejection(blockedClose.body, "nope");
    const still = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(still.body, new RegExp(`<td>Q<br>${displayName}</td>`));

    const offer = await send(port, "POST", "/session/offer", cookie, { invite, displayName: "Nobody" });
    assert.equal(offer.status, 400);
    assert.match(offer.body, /That did not change the Session\./);
    assert.equal(offer.body.includes("That Square did not take the letter."), false);
    const decline = await send(port, "POST", "/session/decline", cookie, { invite, displayName });
    assert.match(decline.body, /That did not change the Session\./);
    const invited = await send(port, "POST", "/session/invite", cookie, { invite: "nope", email: "sam@example.com" });
    assert.match(invited.body, /That did not change the Session\./);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
});

test("a signed-in Player sees the Grid and Words of a published Freestyle Crossword and a published Standard Crossword", async () => {
  const port = await freePort();
  const child = await startServer(port);
  const stamp = Date.now();
  const title = `Pair${stamp}`;
  const standardTitle = `Block${stamp}`;
  try {
    const sent = await send(port, "POST", "/sign-in", null, { email: `ada${stamp}@example.com` });
    const magic = sent.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const signed = await send(port, "GET", magic, null);
    const cookie = signed.cookie;
    assert.ok(cookie);

    const blankCrossword = {
      title,
      kind: "freestyle",
      size: 9,
      squares: Array.from({ length: 81 }, (_, index) => {
        const row = Math.floor(index / 9);
        const column = index % 9;
        if (row === 0 && column < 3) return "CAT"[column];
        if (row === 1 && column < 3) return "DOG"[column];
        return "#";
      }),
      words: [
        { direction: "across", row: 0, column: 0, answer: "CAT", clue: "Feline" },
        { direction: "across", row: 1, column: 0, answer: "DOG", clue: "Hound" },
      ],
    };
    const namedCrossword = {
      title,
      kind: "freestyle",
      size: 9,
      squares: Array.from({ length: 81 }, (_, index) => (Math.floor(index / 9) === 0 ? "A" : "#")),
      words: [{ direction: "across", row: 0, column: 0, answer: "AAAAAAAAA", clue: "Nine As" }],
    };
    const standardCrossword = {
      title: standardTitle,
      kind: "standard",
      size: 15,
      squares: Array.from({ length: 225 }, () => "A"),
      words: Array.from({ length: 15 }, (_, index) => [
        { direction: "across", row: index, column: 0, answer: "A".repeat(15), clue: `Across ${index + 1}` },
        { direction: "down", row: 0, column: index, answer: "A".repeat(15), clue: `Down ${index + 1}` },
      ]).flat(),
    };

    assert.equal((await send(port, "POST", "/publish", cookie, { author: "", crossword: JSON.stringify(blankCrossword) })).status, 200);
    assert.equal((await send(port, "POST", "/publish", cookie, { author: "Ada", crossword: JSON.stringify(namedCrossword) })).status, 200);
    assert.equal((await send(port, "POST", "/publish", cookie, { author: "Ada", crossword: JSON.stringify(standardCrossword) })).status, 200);

    const blank = await send(port, "GET", `/published-crossword?title=${encodeURIComponent(title)}&author=`, cookie);
    assert.equal(blank.status, 200);
    assert.match(blank.body, new RegExp(`<h1>${title}</h1>`));
    assert.match(blank.body, /<p>no Author<\/p>/);
    assert.match(
      blank.body,
      /<table class="grid">\s*<tr>\s*<td>C<\/td>\s*<td>A<\/td>\s*<td>T<\/td>(?:\s*<td class="block"><\/td>){6}\s*<\/tr>\s*<tr>\s*<td>D<\/td>\s*<td>O<\/td>\s*<td>G<\/td>(?:\s*<td class="block"><\/td>){6}\s*<\/tr>(?:\s*<tr>(?:\s*<td class="block"><\/td>){9}\s*<\/tr>){7}\s*<\/table>/,
    );
    assert.match(blank.body, /<ul>\s*<li>across 3: Feline<\/li>\s*<li>across 3: Hound<\/li>\s*<\/ul>/);
    assert.match(blank.body, /<p>2 Words<\/p>/);
    assert.match(blank.body, new RegExp(`<input type="hidden" name="title" value="${title}">`));
    assert.match(blank.body, /<input type="hidden" name="author" value="">/);
    assert.equal(blank.body.includes('value="no Author"'), false);
    assert.match(blank.body, /<button type="submit">Start a Session<\/button>/);

    const named = await send(port, "GET", `/published-crossword?title=${encodeURIComponent(title)}&author=${encodeURIComponent("Ada")}`, cookie);
    assert.equal(named.status, 200);
    assert.match(named.body, /<p>Ada<\/p>/);
    assert.match(named.body, /<table class="grid">\s*<tr>(?:\s*<td>A<\/td>){9}\s*<\/tr>(?:\s*<tr>(?:\s*<td class="block"><\/td>){9}\s*<\/tr>){8}\s*<\/table>/);
    assert.match(named.body, /<ul>\s*<li>across 9: Nine As<\/li>\s*<\/ul>/);
    assert.match(named.body, /<p>1 Words<\/p>/);
    assert.match(named.body, /<input type="hidden" name="author" value="Ada">/);

    const standard = await send(port, "GET", `/published-crossword?title=${encodeURIComponent(standardTitle)}&author=${encodeURIComponent("Ada")}`, cookie);
    assert.equal(standard.status, 200);
    assert.match(standard.body, new RegExp(`<h1>${standardTitle}</h1>`));
    assert.match(standard.body, /<table class="grid">(?:\s*<tr>(?:\s*<td>A<\/td>){15}\s*<\/tr>){15}\s*<\/table>/);
    assert.equal(standard.body.includes('class="block"'), false);
    assert.match(standard.body, /<ul>\s*<li>across 15: Across 1<\/li>\s*<li>down 15: Down 1<\/li>\s*<li>across 15: Across 2<\/li>/);
    assert.match(standard.body, /<li>across 15: Across 15<\/li>\s*<li>down 15: Down 15<\/li>\s*<\/ul>/);
    assert.match(standard.body, /<p>30 Words<\/p>/);
    assert.match(standard.body, /<p>Ada<\/p>/);

    const started = await send(port, "POST", "/session", cookie, { title, author: "" });
    assert.equal(started.status, 303);
    const invite = new URL(started.location ?? "", "http://localhost").searchParams.get("invite") ?? "";
    const session = await send(port, "GET", `/session?invite=${encodeURIComponent(invite)}`, cookie);
    assert.match(session.body, /Feline/);
    assert.equal(session.body.includes("Nine As"), false);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
});
