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

function menuLinks(body: string): string[][] {
  const menu = body.match(/<summary>Menu<\/summary>\s*<nav>([\s\S]*?)<\/nav>/);
  assert.ok(menu);
  return [...menu[1].matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
}

function footerLinks(body: string): string[][] {
  const footer = body.match(/<footer>([\s\S]*?)<\/footer>/);
  assert.ok(footer);
  return [...footer[1].matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
}

function clueList(body: string, heading: string): string[] {
  const section = body.match(new RegExp(`<h2>${heading}</h2>\\s*<ul>([\\s\\S]*?)</ul>`));
  assert.ok(section, heading);
  return [...section[1].matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1]);
}

function playerStatus(body: string): string {
  const start = body.indexOf('<section class="player-status">');
  const end = body.indexOf("</section>", start);
  assert.ok(start !== -1 && end !== -1);
  return body.slice(start, end);
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

    const libraryUnsigned = await send(port, "GET", "/library", null);
    const aboutUnsigned = await send(port, "GET", "/about", null);
    const supportUnsigned = await send(port, "GET", "/support", null);
    assert.equal(aboutUnsigned.status, libraryUnsigned.status);
    assert.equal(aboutUnsigned.location, libraryUnsigned.location);
    assert.equal(aboutUnsigned.body, libraryUnsigned.body);
    assert.equal(supportUnsigned.status, libraryUnsigned.status);
    assert.equal(supportUnsigned.location, libraryUnsigned.location);
    assert.equal(supportUnsigned.body, libraryUnsigned.body);

    const about = await send(port, "GET", "/about", cookie);
    assert.equal(about.status, 200);
    assert.match(about.body, /About Us is coming soon\./);
    assert.equal(about.body.includes("Support is coming soon."), false);
    assert.equal(about.body.includes("<summary>Menu</summary>"), false);
    assert.equal(about.body.includes("<footer>"), false);
    assert.equal(about.body.includes("Game"), false);
    assert.equal(about.body.includes("<style"), false);
    assert.deepEqual(
      [...about.body.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]),
      [["/", "Home"]],
    );
    const support = await send(port, "GET", "/support", cookie);
    assert.equal(support.status, 200);
    assert.match(support.body, /Support is coming soon\./);
    assert.equal(support.body.includes("About Us is coming soon."), false);
    assert.equal(support.body.includes("<summary>Menu</summary>"), false);
    assert.equal(support.body.includes("<footer>"), false);
    assert.equal(support.body.includes("Game"), false);
    assert.deepEqual(
      [...support.body.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]),
      [["/", "Home"]],
    );

    const signedOut = await send(port, "GET", "/", null);
    assert.match(signedOut.body, /Email me a magic link/);
    assert.equal(signedOut.body.includes("<summary>Menu</summary>"), false);
    for (const path of ["/", "/library", "/publish", "/published", "/completions"]) {
      const unchanged = await send(port, "GET", path, cookie);
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.body.includes("<summary>Menu</summary>"), false);
      assert.equal(unchanged.body.includes("About Us"), false);
      assert.equal(unchanged.body.includes("Game"), false);
    }

    const first = await send(port, "GET", "/crossword?title=First%20Row", cookie);
    assert.equal(first.status, 200);
    assert.match(first.body, /<link rel="stylesheet" href="\/co-opword.css">/);
    assert.equal(first.body.includes("<style"), false);
    assert.equal(first.body.includes(" style="), false);
    assert.equal(first.body.includes("<script"), false);
    assert.match(first.body, /<h1>First Row<\/h1>/);
    assert.match(first.body, /<p class="brand">Co-opword<\/p>/);
    assert.equal(first.body.includes("Author"), false);
    assert.equal(first.body.includes("Invite"), false);
    assert.equal(first.body.includes(">Type<"), false);
    assert.equal(first.body.includes("Offer friendship"), false);
    assert.equal(first.body.includes("Game"), false);
    assert.deepEqual(menuLinks(first.body), [
      ["/", "Home"],
      ["/library", "Library"],
      ["/publish", "Publish"],
      ["/published", "Published"],
      ["/completions", "Completions"],
    ]);
    assert.deepEqual(footerLinks(first.body), [
      ["/about", "About Us"],
      ["/support", "Support"],
      ["/completions", "Completions"],
    ]);
    assert.deepEqual(clueList(first.body, "Across"), ["across 9: Nine As"]);
    assert.deepEqual(clueList(first.body, "Down"), []);
    assert.equal(first.body.split('<td class="block"></td>').length - 1, 72);
    assert.equal(first.body.split("<td>A</td>").length - 1, 9);
    const firstGrid = first.body.indexOf('<table class="grid">');
    assert.ok(first.body.indexOf("<header>") < first.body.indexOf("<h1>"));
    assert.ok(firstGrid < first.body.indexOf("Start a Session"));
    assert.ok(first.body.indexOf("Start a Session") < first.body.indexOf("<h2>Across</h2>"));
    assert.ok(first.body.indexOf("<h2>Across</h2>") < first.body.indexOf("<footer>"));
    assert.match(first.body, /<a href="\/library">Library<\/a>/);
    assert.match(first.body, /<form method="post" action="\/session">/);

    const filled = await send(port, "GET", "/crossword?title=Filled%20Fifteen", cookie);
    assert.deepEqual(
      clueList(filled.body, "Across"),
      Array.from({ length: 15 }, (_, index) => `across 15: Across ${index + 1}`),
    );
    assert.deepEqual(
      clueList(filled.body, "Down"),
      Array.from({ length: 15 }, (_, index) => `down 15: Down ${index + 1}`),
    );

    const freshStart = await send(port, "POST", "/session", cookie, { title: "First Row" });
    const freshInvite = new URL(freshStart.location ?? "", "http://localhost").searchParams.get("invite") ?? "";
    const live = await send(port, "GET", sessionPath(freshInvite), cookie);
    assert.match(live.body, /<p class="brand">Co-opword<\/p>/);
    assert.match(live.body, /\(C\) Co-opword/);
    assert.match(live.body, /class="page-turn"/);
    assert.equal(live.body.includes("<summary>Menu</summary>"), false);
    assert.match(live.body, new RegExp(`<code>${freshInvite}</code>`));
    assert.match(live.body, new RegExp(`<a href="/join\\?invite=${encodeURIComponent(freshInvite)}">`));
    assert.equal(live.body.includes("clipboard"), false);
    assert.equal(live.body.includes("<script"), false);
    assert.equal(live.body.includes("Game"), false);
    assert.equal(live.body.includes("<td>A</td>"), false);
    assert.equal(playerStatus(live.body).includes("<li>"), false);
    assert.deepEqual(clueList(live.body, "Across"), ["across 9: Nine As"]);
    assert.deepEqual(clueList(live.body, "Down"), []);
    const liveGrid = live.body.indexOf('<table class="grid">');
    assert.ok(live.body.indexOf("<code>") < liveGrid);
    assert.ok(liveGrid < live.body.indexOf("<h2>Player Status</h2>"));
    assert.ok(live.body.indexOf("<h2>Player Status</h2>") < live.body.indexOf("<h2>Across</h2>"));
    assert.ok(live.body.indexOf("<h2>Across</h2>") < live.body.indexOf("<h2>Current Selection</h2>"));
    assert.ok(live.body.indexOf("<h2>Current Selection</h2>") < live.body.indexOf("<h2>Session Management</h2>"));
    assert.ok(live.body.indexOf("<h2>Session Management</h2>") < live.body.indexOf("<footer>"));
    for (const [label, kind] of [
      ["Type", "filled"],
      ["Select", "filled"],
      ["Invite Player", "filled"],
      ["Clear", "plain"],
      ["Close", "plain"],
      ["Offer friendship", "plain"],
      ["Decline", "plain"],
    ]) {
      const found = live.body.match(new RegExp(`<button[^>]*>${label}</button>`));
      assert.ok(found, label);
      assert.match(found[0], new RegExp(`class="${kind}"`));
    }
    assert.match(live.body, /formaction="\/session\/select"/);
    assert.match(live.body, /formaction="\/session\/clear"/);
    assert.match(live.body, /formaction="\/session\/close"/);
    assert.match(live.body, /action="\/session\/letter"/);
    assert.match(live.body, /action="\/session\/invite"/);
    assert.match(live.body, /action="\/session\/offer"/);
    assert.match(live.body, /formaction="\/session\/decline"/);
    assert.match(live.body, /name="displayName"/);
    assert.match(live.body, /name="email"/);
    assert.match(live.body, /name="index"/);
    assert.match(live.body, /name="letter"/);

    const samName = `Sam${Date.now()}`;
    const samSent = await send(port, "POST", "/sign-in", null, { email: `sam${Date.now()}@example.com` });
    const samMagic = samSent.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const samSigned = await send(port, "GET", samMagic, null);
    const sam = samSigned.cookie;
    assert.ok(sam);
    await send(port, "POST", "/display-name", sam, { displayName: samName });
    const joined = await send(port, "GET", `/join?invite=${encodeURIComponent(freshInvite)}`, sam);
    assert.equal(joined.status, 303);
    await send(port, "POST", "/session/offer", cookie, { invite: freshInvite, displayName: samName });
    const samLive = await send(port, "GET", sessionPath(freshInvite), sam);
    assert.match(playerStatus(samLive.body), new RegExp(`<li>${displayName} pending</li>`));
    const adaLive = await send(port, "GET", sessionPath(freshInvite), cookie);
    assert.match(playerStatus(adaLive.body), new RegExp(`<li>${samName}</li>`));

    const publishedTitle = `Page${Date.now()}`;
    const crossword = {
      title: publishedTitle,
      kind: "freestyle",
      size: 9,
      squares: Array.from({ length: 81 }, (_, index) => (Math.floor(index / 9) === 0 ? "A" : "#")),
      words: [{ direction: "across", row: 0, column: 0, answer: "AAAAAAAAA", clue: "Nine As" }],
    };
    const publishedPost = await send(port, "POST", "/publish", cookie, { author: displayName, crossword: JSON.stringify(crossword) });
    assert.equal(publishedPost.status, 200);
    const published = await send(
      port,
      "GET",
      `/published-crossword?title=${encodeURIComponent(publishedTitle)}&author=${encodeURIComponent(displayName)}`,
      cookie,
    );
    assert.equal(published.status, 200);
    assert.match(published.body, new RegExp(`<h1>${publishedTitle}</h1>`));
    assert.match(published.body, new RegExp(`<p>${displayName}</p>`));
    assert.match(published.body, /<p>1 Words<\/p>/);
    assert.match(published.body, /Start a Session/);
    assert.equal(published.body.includes("<summary>Menu</summary>"), false);
    assert.equal(published.body.includes("About Us"), false);
    assert.equal(published.body.includes('href="/support"'), false);
    assert.equal(published.body.includes("Game"), false);
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
