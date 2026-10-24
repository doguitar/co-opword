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
    env: { ...process.env, PORT: String(port) },
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
