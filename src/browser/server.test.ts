import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

type Started = { child: ChildProcess; output: () => string };

async function startServer(port: number, env: Record<string, string | undefined> = {}): Promise<ChildProcess> {
  const started = await startServerProcess(port, env);
  return started.child;
}

async function startServerProcess(port: number, env: Record<string, string | undefined> = {}): Promise<Started> {
  let output = "";
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/browser/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATABASE_URL: "sqlite::memory:",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  return { child, output: () => output };
}

async function startServerExpectExit(env: Record<string, string | undefined>): Promise<{ code: number | null; output: string }> {
  const port = await freePort();
  let output = "";
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/browser/server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  let timedOut = false;
  // The startup watchdog must use real time to reap a child process if a regression leaves it running.
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 5_000);
  try {
    const [code] = await once(child, "exit");
    if (timedOut) throw new Error(output || "server did not exit after invalid production config");
    return { code: code as number | null, output };
  } finally {
    clearTimeout(timeout);
  }
}

type SecurityHeaders = {
  csp: string | null;
  frameOptions: string | null;
  nosniff: string | null;
  referrerPolicy: string | null;
};

type Reply = {
  status: number;
  body: string;
  location: string | null;
  cookie: string | null;
  setCookie: string | null;
  type: string;
  retryAfter: string | null;
} & SecurityHeaders;

function securityHeadersOf(response: Response): SecurityHeaders {
  return {
    csp: response.headers.get("content-security-policy"),
    frameOptions: response.headers.get("x-frame-options"),
    nosniff: response.headers.get("x-content-type-options"),
    referrerPolicy: response.headers.get("referrer-policy"),
  };
}

function assertAppSecurityHeaders(headers: SecurityHeaders): void {
  assert.equal(
    headers.csp,
    "script-src 'self'; style-src 'self'; form-action 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  assert.equal(headers.frameOptions, "DENY");
  assert.equal(headers.nosniff, "nosniff");
  assert.equal(headers.referrerPolicy, "same-origin");
  assert.equal(headers.csp?.includes("unsafe-inline"), false);
  assert.equal(headers.csp?.includes("unsafe-eval"), false);
}

const maxBodyBytes = 262144;

function replyFrom(response: Response, body: string): Reply {
  const setCookie = response.headers.getSetCookie().find((entry) => entry.startsWith("player="));
  return {
    status: response.status,
    body,
    location: response.headers.get("location"),
    cookie: setCookie ? setCookie.split(";")[0] : null,
    setCookie: setCookie ?? null,
    type: response.headers.get("content-type") ?? "",
    retryAfter: response.headers.get("retry-after"),
    ...securityHeadersOf(response),
  };
}

async function send(
  port: number,
  method: string,
  path: string,
  cookie: string | null,
  body?: Record<string, string> | URLSearchParams,
  origin?: string,
): Promise<Reply> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? (body instanceof URLSearchParams ? body : new URLSearchParams(body)) : undefined,
    redirect: "manual",
  });
  return replyFrom(response, await response.text());
}

function readHttpReply(response: http.IncomingMessage, resolve: (reply: Reply) => void): void {
  const parts: Buffer[] = [];
  response.on("data", (chunk: Buffer) => parts.push(chunk));
  response.on("end", () => {
    const setCookieHeader = response.headers["set-cookie"];
    const setCookie = (Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : []).find((entry) =>
      entry.startsWith("player="),
    );
    resolve({
      status: response.statusCode ?? 0,
      body: Buffer.concat(parts).toString("utf8"),
      location: typeof response.headers.location === "string" ? response.headers.location : null,
      cookie: setCookie ? setCookie.split(";")[0] : null,
      setCookie: setCookie ?? null,
      type: typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : "",
      retryAfter: typeof response.headers["retry-after"] === "string" ? response.headers["retry-after"] : null,
      csp: typeof response.headers["content-security-policy"] === "string" ? response.headers["content-security-policy"] : null,
      frameOptions: typeof response.headers["x-frame-options"] === "string" ? response.headers["x-frame-options"] : null,
      nosniff: typeof response.headers["x-content-type-options"] === "string" ? response.headers["x-content-type-options"] : null,
      referrerPolicy: typeof response.headers["referrer-policy"] === "string" ? response.headers["referrer-policy"] : null,
    });
  });
}

function sendBytes(port: number, path: string, body: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let gotResponse = false;
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        gotResponse = true;
        readHttpReply(response, resolve);
      },
    );
    request.on("error", (error) => {
      // Server may reset after a 413 while the client is still writing the body.
      if (gotResponse && (error as NodeJS.ErrnoException).code === "ECONNRESET") return;
      reject(error);
    });
    request.write(body);
    request.end();
  });
}

function sendChunked(port: number, path: string, chunks: string[], cookie: string | null = null): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let gotResponse = false;
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "transfer-encoding": "chunked",
          ...(cookie ? { cookie } : {}),
        },
      },
      (response) => {
        gotResponse = true;
        readHttpReply(response, resolve);
      },
    );
    request.on("error", (error) => {
      if (gotResponse && (error as NodeJS.ErrnoException).code === "ECONNRESET") return;
      reject(error);
    });
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

function sendDuringShutdown(
  port: number,
  path: string,
  cookie: string,
  body: URLSearchParams,
  beforeFinishingBody: () => Promise<void>,
): Promise<Reply> {
  const encodedBody = body.toString();
  return new Promise<Reply>((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(encodedBody),
          expect: "100-continue",
          cookie,
        },
      },
      (response) => readHttpReply(response, resolve),
    );
    request.on("continue", () => {
      const split = Math.floor(encodedBody.length / 2);
      request.write(encodedBody.slice(0, split));
      void beforeFinishingBody().then(
        () => request.end(encodedBody.slice(split)),
        (error: unknown) => {
          request.destroy();
          reject(error);
        },
      );
    });
    request.on("error", reject);
    request.flushHeaders();
  });
}

function formBody(email: string, size: number): string {
  const prefix = `email=${encodeURIComponent(email)}&pad=`;
  assert.ok(size >= prefix.length);
  return prefix + "x".repeat(size - prefix.length);
}

type Watch = {
  status: number;
  type: string;
  text: () => string;
  events: () => number;
  untilOpen: () => Promise<void>;
  untilCount: (count: number) => Promise<void>;
  untilClosed: () => Promise<void>;
  stop: () => void;
} & SecurityHeaders;

function watchSession(port: number, invite: string, cookie: string | null): Promise<Watch> {
  const controller = new AbortController();
  return fetch(`http://127.0.0.1:${port}/session/events?invite=${encodeURIComponent(invite)}`, {
    headers: { accept: "text/event-stream", ...(cookie ? { cookie } : {}) },
    signal: controller.signal,
  }).then(async (response) => {
    let text = "";
    let resolveClosed: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += decoder.decode(value, { stream: true });
          }
        } catch {
          // The test closed this stream.
        } finally {
          resolveClosed();
        }
      })();
    } else {
      text = await response.text();
      resolveClosed();
    }
    const events = () => text.split("event: session").length - 1;
    const waitUntil = async (ready: () => boolean, detail: () => string) => {
      const deadline = Date.now() + 4000;
      while (!ready()) {
        if (Date.now() > deadline) throw new Error(detail());
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
      text: () => text,
      events,
      untilOpen: () => waitUntil(() => text.includes(": open"), () => `stream ${response.status} ${JSON.stringify(text)}`),
      untilCount: (count: number) => waitUntil(() => events() >= count, () => `saw ${events()} session events in ${JSON.stringify(text)}`),
      untilClosed: () => closed,
      stop: () => controller.abort(),
      ...securityHeadersOf(response),
    };
  });
}

async function getHealth(port: number): Promise<{ status: number; body: string; type: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return {
    status: response.status,
    body: await response.text(),
    type: response.headers.get("content-type") ?? "",
  };
}

function squareClass(body: string, index: string): string {
  const match = body.match(new RegExp(`<td class=\"([^\"]*)\">\\s*<button type=\"submit\" name=\"index\" value=\"${index}\"`));
  assert.ok(match, index);
  return match[1];
}

async function confirmMagicLink(port: number, href: string): Promise<Reply> {
  const confirmation = await send(port, "GET", href, null);
  assert.equal(confirmation.status, 200);
  const token = new URL(href, `http://127.0.0.1:${port}`).searchParams.get("token") ?? "";
  assert.ok(token);
  return send(port, "POST", "/magic", null, { token }, `http://127.0.0.1:${port}`);
}

async function signIn(port: number, label: string): Promise<string> {
  const sent = await send(port, "POST", "/sign-in", null, { email: `${label}-${Date.now()}@example.com` });
  const magic = sent.body.match(/<a href=\"([^\"]+)\">/)?.[1] ?? "";
  const signed = await confirmMagicLink(port, magic);
  const cookie = signed.cookie;
  assert.ok(cookie);
  await send(port, "POST", "/display-name", cookie, { displayName: `${label}${Date.now()}` });
  return cookie;
}

function menuLinks(body: string): string[][] {
  const menu = body.match(/<nav class="menu"[^>]*>([\s\S]*?)<\/nav>/);
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
  return [...section[1].matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => match[1]);
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

test("GET magic confirms without consuming; only a same-origin POST signs in", async () => {
  const port = await freePort();
  const child = await startServer(port);
  const localOrigin = `http://127.0.0.1:${port}`;
  try {
    const sent = await send(port, "POST", "/sign-in", null, { email: `confirm-${Date.now()}@example.com` });
    const magic = sent.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const token = new URL(magic, localOrigin).searchParams.get("token") ?? "";
    assert.ok(token);

    const confirmation = await send(port, "GET", magic, null);
    assert.equal(confirmation.status, 200);
    assert.equal(confirmation.cookie, null);
    assert.match(confirmation.body, /action="\/magic"/);
    assert.match(confirmation.body, new RegExp(`name="token" value="${token}"`));

    const scannedAgain = await send(port, "GET", magic, null);
    assert.equal(scannedAgain.status, 200);
    assert.equal(scannedAgain.cookie, null);

    const invalid = await send(port, "GET", "/magic?token=not-valid", null);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.cookie, null);
    assert.match(invalid.body, /That magic link is no longer valid\./);

    const missingOrigin = await send(port, "POST", "/magic", null, { token });
    assert.equal(missingOrigin.status, 403);
    const crossOrigin = await send(port, "POST", "/magic", null, { token }, "https://evil.example");
    assert.equal(crossOrigin.status, 403);

    const signed = await send(port, "POST", "/magic", null, { token }, localOrigin);
    assert.equal(signed.status, 303);
    assert.ok(signed.cookie);
    assert.equal(signed.location, "/");

    const replayed = await send(port, "POST", "/magic", null, { token }, localOrigin);
    assert.equal(replayed.status, 400);
    assert.match(replayed.body, /That magic link is no longer valid\./);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("HTML and Session stream replies send the app security headers", async () => {
  const port = await freePort();
  const child = await startServer(port);
  let stream: Watch | undefined;
  try {
    const page = await send(port, "GET", "/", null);
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assertAppSecurityHeaders(page);

    const cookie = await signIn(port, "headers");
    const started = await send(port, "POST", "/session", cookie, { title: "First Row" });
    const invite = new URL(started.location ?? "", "http://localhost").searchParams.get("invite") ?? "";
    assert.equal(started.status, 303);
    assertAppSecurityHeaders(started);

    stream = await watchSession(port, invite, cookie);
    assert.equal(stream.status, 200);
    assert.match(stream.type, /text\/event-stream/);
    assertAppSecurityHeaders(stream);
    await stream.untilOpen();

    const stylesheet = await send(port, "GET", "/co-opword.css", null);
    assert.equal(stylesheet.status, 200);
    assert.equal(stylesheet.nosniff, "nosniff");
  } finally {
    stream?.stop();
    child.kill();
    await once(child, "exit");
  }
});

test("a signed-in Player signs out from the menu", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const cookie = await signIn(port, "signout");
    const home = await send(port, "GET", "/", cookie);
    const menu = home.body.match(/<nav class="menu"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(menu);
    assert.deepEqual(menuLinks(home.body), [
      ["/", "Home"],
      ["/library", "Library"],
      ["/build", "Build"],
      ["/publish", "Publish"],
      ["/published", "Published"],
      ["/completions", "Completions"],
      ["/about", "About"],
      ["/support", "Support"],
      ["/help", "Help"],
      ["/profile", "Profile"],
    ]);
    const signOut = [...home.body.matchAll(/<form method="post" action="\/sign-out">([\s\S]*?)<\/form>/g)];
    assert.equal(signOut.length, 1);
    assert.match(signOut[0][1], /<button type="submit" class="plain">Sign out<\/button>/);
    assert.equal(menu[1].includes(signOut[0][0]), true);
    assert.equal(home.body.replace(menu[0], "").includes('action="/sign-out"'), false);
    assert.match(menu[1], /<a href="\/help">Help<\/a>/);
    assert.match(menu[1], /<a href="\/profile">Profile<\/a>/);

    const missed = await send(port, "GET", "/sign-out", cookie);
    assert.equal(missed.status, 404);
    assert.equal(missed.setCookie, null);
    const stillIn = await send(port, "GET", "/", cookie);
    assert.match(stillIn.body, /<section class="home">/);
    assert.doesNotMatch(stillIn.body, /action="\/sign-in"/);

    const signedOut = await send(port, "POST", "/sign-out", cookie);
    assert.equal(signedOut.status, 303);
    assert.equal(signedOut.location, "/");
    assert.match(signedOut.setCookie ?? "", /^player=; Max-Age=0;/);
    assert.match(signedOut.setCookie ?? "", /HttpOnly; Path=\/; SameSite=Lax/);
    const signInPage = await send(port, "GET", "/", null);
    assert.match(signInPage.body, /action="\/sign-in"/);
    assert.deepEqual(menuLinks(signInPage.body), menuLinks(home.body));
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("Profile shows this Player's display name and sends anyone else to Sign in", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const email = `profile-${Date.now()}@example.com`;
    const sent = await send(port, "POST", "/sign-in", null, { email });
    const magic = sent.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const signed = await confirmMagicLink(port, magic);
    const cookie = signed.cookie;
    assert.ok(cookie);

    const unnamed = await send(port, "GET", "/profile", cookie);
    assert.equal(unnamed.status, 200);
    assert.match(unnamed.body, /<section class="column">[\s\S]*<h1>Profile<\/h1>/);
    assert.match(unnamed.body, /<p>You have not chosen a display name yet\.<\/p>/);
    assert.match(unnamed.body, /<form method="post" action="\/display-name">/);
    assert.match(unnamed.body, /<button type="submit" class="filled">Choose<\/button>/);
    assert.equal(unnamed.body.includes(email), false);
    assert.equal(unnamed.body.includes("@"), false);

    const displayName = `Ada${Date.now()}`;
    await send(port, "POST", "/display-name", cookie, { displayName });
    const named = await send(port, "GET", "/profile", cookie);
    assert.equal(named.status, 200);
    assert.match(named.body, new RegExp(`<p>Welcome back, ${displayName}</p>`));
    assert.match(named.body, new RegExp(`name="displayName" value="${displayName}"`));
    assert.match(named.body, /<button type="submit" class="filled">Change display name<\/button>/);
    assert.equal(named.body.includes(email), false);

    const signedOut = await send(port, "GET", "/profile", null);
    assert.equal(signedOut.status, 303);
    assert.equal(signedOut.location, "/");
    assert.match(signedOut.body, /Sign in\./);

    const rejected = await send(port, "GET", "/profile", "player=nonsense");
    assert.equal(rejected.status, 303);
    assert.equal(rejected.location, "/");
    assert.match(rejected.body, /Sign in\./);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("Help is the same public guide for any Player cookie", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const signedOut = await send(port, "GET", "/help", null);
    const tasks = [
      "Sign in and a display name",
      "Choose a Crossword",
      "Start or join a Session",
      "Fill the Grid",
      "Completions",
      "Build, Publish, and Revise",
    ];
    assert.equal(signedOut.status, 200);
    assert.equal(signedOut.location, null);
    assert.match(signedOut.body, /<h1>Help<\/h1>/);
    for (const task of tasks) assert.match(signedOut.body, new RegExp(`<h2 id="[^"]+">${task}</h2>`));
    assert.match(signedOut.body, /<p class="brand">Co-opword<\/p>/);
    assert.match(signedOut.body, /<footer>/);
    assert.equal(signedOut.body.includes("<style"), false);
    assert.equal(signedOut.body.includes(" style="), false);
    assert.equal(signedOut.body.includes("Game"), false);
    assert.match(signedOut.body, /greets "Welcome back, " plus the name/);
    assert.equal(/Welcome back, [A-Za-z0-9]/.test(signedOut.body), false);
    assert.equal(signedOut.body.includes("@"), false);
    assert.equal(signedOut.body.includes("Invite code"), false);
    assert.equal(signedOut.body.includes("Sign in again."), false);
    assert.equal(signedOut.body.includes("About Us is coming soon."), false);
    assert.equal(signedOut.body.includes("Support is coming soon."), false);
    assert.match(signedOut.body, /That display name is already taken/);
    assert.match(signedOut.body, /no Author/);
    assert.match(signedOut.body, /Presence/);
    assert.match(signedOut.body, /Lock/);
    assert.match(signedOut.body, /seven days/);
    assert.match(signedOut.body, /The Grid matched/);
    assert.match(signedOut.body, /Freestyle/);
    assert.match(signedOut.body, /Standard/);
    assert.match(signedOut.body, /Revise link/);
    const main = signedOut.body.match(/<main>([\s\S]*?)<\/main>/);
    assert.ok(main);
    assert.deepEqual(
      [...main[1].matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
      ["#sign-in", "#choose", "#session", "#grid", "#completions", "#build"],
    );
    const cookie = await signIn(port, "help");
    const signedIn = await send(port, "GET", "/help", cookie);
    const nonsense = await send(port, "GET", "/help", "player=nonsense");
    assert.equal(signedIn.status, 200);
    assert.equal(nonsense.status, 200);
    assert.equal(signedIn.body, signedOut.body);
    assert.equal(nonsense.body, signedOut.body);
    const posted = await send(port, "POST", "/help", null);
    const notFound = await send(port, "GET", "/sign-out", null);
    assert.equal(posted.status, notFound.status);
    assert.equal(posted.body, notFound.body);
    assert.equal(posted.status, 404);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("the site map names Help as a signed-out page", () => {
  const map = readFileSync(join(root, "SITEMAP.md"), "utf8");
  assert.match(map, /except Sign in, Revise, and Help/);
  const profileAt = map.indexOf("## Profile");
  const libraryAt = map.indexOf("## Library");
  assert.ok(profileAt >= 0 && profileAt < libraryAt);
  const profile = map.slice(profileAt, libraryAt);
  assert.match(profile, /signed-in/i);
  assert.match(profile, /menu/);
  assert.match(profile, /display name/);
  assert.equal(profile.includes("email"), false);
  const help = map.slice(map.indexOf("## Help"));
  assert.match(help, /read-only/i);
  assert.match(help, /menu/);
  assert.match(help, /Sign in/);
  assert.match(help, /nowhere/i);
  assert.equal(help.includes("email"), false);
  assert.equal(help.includes("display name"), false);
  assert.equal(help.includes("Invite"), false);
});

test("a Player can rename their display name after signing in", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const cookie = await signIn(port, "rename");
    const displayName = `Renamed${Date.now()}`;
    const changed = await send(port, "POST", "/display-name", cookie, { displayName });
    assert.equal(changed.status, 303);
    assert.equal(changed.location, "/");
    const home = await send(port, "GET", "/", cookie);
    assert.match(home.body, new RegExp(`<p>Welcome back, ${displayName}</p>`));
    assert.equal(home.body.includes('action="/display-name"'), false);
    const profile = await send(port, "GET", "/profile", cookie);
    assert.match(profile.body, new RegExp(`name="displayName" value="${displayName}"`));
    assert.match(profile.body, /name="return" value="\/profile"/);
    const again = `Again${Date.now()}`;
    const fromProfile = await send(port, "POST", "/display-name", cookie, { displayName: again, return: "/profile" });
    assert.equal(fromProfile.status, 303);
    assert.equal(fromProfile.location, "/profile");
    const homeAfter = await send(port, "GET", "/", cookie);
    assert.match(homeAfter.body, new RegExp(`<p>Welcome back, ${again}</p>`));
    assert.equal(homeAfter.body.includes('action="/display-name"'), false);
    const elsewhere = await send(port, "POST", "/display-name", cookie, { displayName: again, return: "/library" });
    assert.equal(elsewhere.status, 303);
    assert.equal(elsewhere.location, "/");
    const other = await signIn(port, "other");
    const taken = await send(port, "POST", "/display-name", other, { displayName: again.toLowerCase(), return: "/profile" });
    assert.equal(taken.status, 400);
    assert.match(taken.body, /That display name is already taken\./);
    assert.match(taken.body, /<a href="\/profile">Back<\/a>/);
    const stray = await send(port, "POST", "/display-name", other, { displayName: again.toLowerCase(), return: "/library" });
    assert.equal(stray.status, 400);
    assert.match(stray.body, /<a href="\/">Back<\/a>/);
    assert.equal(stray.body.includes('href="/library"'), false);
    const still = await send(port, "GET", "/profile", cookie);
    assert.match(still.body, new RegExp(`name="displayName" value="${again}"`));
    const otherProfile = await send(port, "GET", "/profile", other);
    assert.equal(otherProfile.body.includes(`value="${again}"`), false);
    assert.equal(otherProfile.body.includes(again.toLowerCase()), false);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("a rejected letter leaves the Locked letter and links back to that Session", async () => {
  const port = await freePort();
  const child = await startServer(port);
  const sessionPath = (invite: string) => `/session?invite=${encodeURIComponent(invite)}`;
  try {
    const displayName = `Ada${Date.now()}`;
    const sent = await send(port, "POST", "/sign-in", null, { email: `ada${Date.now()}@example.com` });
    const magic = sent.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const signed = await confirmMagicLink(port, magic);
    const cookie = signed.cookie;
    assert.ok(cookie);
    const unnamed = await send(port, "GET", "/", cookie);
    assert.match(unnamed.body, /<button type="submit" class="filled">Choose<\/button>/);
    await send(port, "POST", "/display-name", cookie, { displayName });
    const idleHome = await send(port, "GET", "/", cookie);
    assert.match(idleHome.body, /<h2>Sessions<\/h2>/);
    assert.match(idleHome.body, /No open sessions\. <a href="\/published">Start one from a published crossword\.<\/a>/);
    assert.match(idleHome.body, new RegExp(`<p>Welcome back, ${displayName}</p>`));
    assert.equal(idleHome.body.includes("Other players"), false);
    assert.equal(idleHome.body.includes('action="/display-name"'), false);
    const started = await send(port, "POST", "/session", cookie, { title: "First Row" });
    const invite = new URL(started.location ?? "", "http://localhost").searchParams.get("invite") ?? "";
    assert.equal(started.status, 303);
    assert.equal(started.location, sessionPath(invite));
    const busyHome = await send(port, "GET", "/", cookie);
    assert.equal(busyHome.body.includes(`<a href="${sessionPath(invite)}">First Row</a>`), true);
    assert.equal(busyHome.body.includes("No open sessions."), false);

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
    assert.match(locked.body, /<td class="selected ink-0">[\s\S]*?<span class="letter">B<\/span>/);
    assert.equal(locked.body.includes("That Square did not take the letter."), false);

    const rejected = await send(port, "POST", "/session/letter", cookie, { invite, index: "0", letter: "C" });
    assert.equal(rejected.status, 303);
    assert.equal(rejected.location, `${sessionPath(invite)}&reject=0`);
    const flashed = await send(port, "GET", rejected.location ?? "", cookie);
    assert.match(flashed.body, /<td class="selected ink-0 reject">[\s\S]*?<span class="letter">B<\/span>/);
    assert.equal(flashed.body.includes("That Square did not take the letter."), false);
    const back = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(back.body, /<td class="selected ink-0">[\s\S]*?<span class="letter">B<\/span>/);
    assert.equal(back.body.includes("That Square did not take the letter."), false);
    assert.match(back.body, /Nine As/);

    const next = await send(port, "POST", "/session/select", cookie, { invite, index: "1" });
    assert.equal(next.status, 303);
    await send(port, "POST", "/session/letter", cookie, { invite, index: "1", letter: "A" });
    const same = await send(port, "POST", "/session/letter", cookie, { invite, index: "1", letter: "A" });
    assert.equal(same.status, 303);
    assert.equal(same.location, `${sessionPath(invite)}&reject=1`);
    const notLetter = await send(port, "POST", "/session/letter", cookie, { invite, index: "1", letter: "!" });
    assert.equal(notLetter.status, 303);
    assert.equal(notLetter.location, `${sessionPath(invite)}&reject=1`);
    const kept = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(kept.body, /<span class="letter">B<\/span>/);
    assert.match(kept.body, /<td class="selected ink-0">[\s\S]*?<span class="letter">A<\/span>/);
    assert.equal(kept.body.includes("<td>!"), false);

    const closed = await send(port, "POST", "/session/close", cookie, { invite });
    assert.equal(closed.status, 303);
    assert.equal(closed.location, "/");
    const reopened = await send(port, "GET", sessionPath(invite), cookie);
    assert.equal(reopened.status, 200);
    assert.match(reopened.body, /<span class="letter">B<\/span>/);
    assert.match(reopened.body, /<span class="letter">A<\/span>/);
    assert.equal(reopened.body.includes("selected ink-0"), false);
    assert.equal(reopened.body.includes("That Square did not take the letter."), false);

    const cleared = await send(port, "POST", "/session/clear", cookie, { invite, index: "0" });
    assert.equal(cleared.status, 303);
    await send(port, "POST", "/session/select", cookie, { invite, index: "0" });
    const retyped = await send(port, "POST", "/session/letter", cookie, { invite, index: "0", letter: "Q" });
    assert.equal(retyped.status, 303);
    const replaced = await send(port, "GET", sessionPath(invite), cookie);
    assert.match(replaced.body, /<td class="selected ink-0">[\s\S]*?<span class="letter">Q<\/span>/);
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
    assert.match(still.body, /<td class="selected ink-0">[\s\S]*?<span class="letter">Q<\/span>/);

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
    assert.match(about.body, /<p class="brand">Co-opword<\/p>/);
    assert.match(about.body, /<footer>/);
    assert.equal(about.body.includes("Game"), false);
    assert.equal(about.body.includes("<style"), false);
    assert.deepEqual(
      [...about.body.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]),
      [
        ["/", "Home"],
        ["/library", "Library"],
        ["/build", "Build"],
        ["/publish", "Publish"],
        ["/published", "Published"],
        ["/completions", "Completions"],
        ["/about", "About"],
        ["/support", "Support"],
        ["/help", "Help"],
        ["/profile", "Profile"],
      ],
    );
    const support = await send(port, "GET", "/support", cookie);
    assert.equal(support.status, 200);
    assert.match(support.body, /Support is coming soon\./);
    assert.equal(support.body.includes("About Us is coming soon."), false);
    assert.match(support.body, /<p class="brand">Co-opword<\/p>/);
    assert.match(support.body, /<footer>/);
    assert.equal(support.body.includes("Game"), false);
    assert.deepEqual(
      [...support.body.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]),
      [
        ["/", "Home"],
        ["/library", "Library"],
        ["/build", "Build"],
        ["/publish", "Publish"],
        ["/published", "Published"],
        ["/completions", "Completions"],
        ["/about", "About"],
        ["/support", "Support"],
        ["/help", "Help"],
        ["/profile", "Profile"],
      ],
    );
    const matched = await send(port, "GET", "/match", cookie);
    assert.equal(matched.status, 200);
    assert.match(matched.body, /<p class="notice">The Grid matched\.<\/p>/);
    assert.match(matched.body, /<a href="\/completions">Completions<\/a>/);
    assert.match(matched.body, /<footer>/);

    const signedOut = await send(port, "GET", "/", null);
    assert.match(signedOut.body, /Email me a magic link/);
    for (const path of ["/", "/library", "/publish", "/published", "/completions"]) {
      const unchanged = await send(port, "GET", path, cookie);
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.body.includes("About Us"), false);
      assert.equal(unchanged.body.includes("Game"), false);
      if (path === "/") assert.match(unchanged.body, /<section class="home">/);
      if (path === "/library") assert.match(unchanged.body, /<section class="column library">/);
      if (path === "/publish") assert.match(unchanged.body, /<section class="column publish">/);
      if (path === "/published") assert.match(unchanged.body, /<section class="column published">/);
      if (path === "/completions") assert.match(unchanged.body, /<section class="column completions">/);
    }

    const first = await send(port, "GET", "/crossword?title=First%20Row", cookie);
    assert.equal(first.status, 200);
    assert.match(first.body, /<link rel="stylesheet" href="\/co-opword.css">/);
    assert.equal(first.body.includes("<style"), false);
    assert.equal(first.body.includes(" style="), false);
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
      ["/build", "Build"],
      ["/publish", "Publish"],
      ["/published", "Published"],
      ["/completions", "Completions"],
      ["/about", "About"],
      ["/support", "Support"],
      ["/help", "Help"],
      ["/profile", "Profile"],
    ]);
    assert.match(first.body, /\(C\) Co-opword/);
    assert.deepEqual(clueList(first.body, "Across"), ["across 9: Nine As"]);
    assert.deepEqual(clueList(first.body, "Down"), []);
    assert.equal(first.body.split('<td class="block"></td>').length - 1, 72);
    assert.equal(first.body.split("<td>A</td>").length - 1, 9);
    const firstGrid = first.body.indexOf('<table class="grid">');
    assert.ok(first.body.indexOf("<header>") < first.body.indexOf("<footer>"));
    assert.ok(first.body.indexOf("<footer>") < first.body.indexOf("<main>"));
    assert.ok(first.body.indexOf("<main>") < first.body.indexOf("<h1>"));
    assert.ok(firstGrid < first.body.indexOf("Start a Session"));
    assert.ok(first.body.indexOf("Start a Session") < first.body.indexOf("<h2>Across</h2>"));
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
    assert.match(live.body, new RegExp(`<p class="invite-code">Invite code: <code>${freshInvite}</code></p>`));
    assert.match(live.body, new RegExp(`<button type="button" class="plain" id="copy-invite" data-invite-link="/join\\?invite=${encodeURIComponent(freshInvite)}">Invite Link</button>`));
    assert.equal(live.body.includes("clipboard"), false);
    assert.equal(live.body.includes("Game"), false);
    assert.equal(live.body.includes("<td>A</td>"), false);
    assert.match(playerStatus(live.body), new RegExp(`<li class="ink-0"><span class="who">${displayName} <span class="letters">0</span></span></li>`));
    assert.deepEqual(clueList(live.body, "Across"), ["1. Nine As"]);
    assert.deepEqual(clueList(live.body, "Down"), []);
    const liveGrid = live.body.indexOf('<table class="grid">');
    assert.ok(live.body.indexOf("<h1>") < liveGrid);
    assert.ok(liveGrid < live.body.indexOf('<section class="player-status">'));
    assert.ok(live.body.indexOf('<section class="player-status">') < live.body.indexOf("<h2>Across</h2>"));
    assert.equal(live.body.includes("Current Selection"), false);
    assert.equal(live.body.includes("Session Management"), false);
    assert.match(live.body, /<span class="number">1<\/span>/);
    assert.match(live.body, /<li class="invite"><button type="button" class="plain" id="open-invite">Invite<\/button><\/li>/);
    assert.match(live.body, /<dialog id="invite-players">/);
    assert.match(live.body, /<button type="button" class="plain" id="close-invite">Cancel<\/button>/);
    assert.ok(live.body.indexOf('<section class="player-status">') < live.body.indexOf('id="open-invite"'));
    assert.ok(live.body.indexOf("<footer>") < live.body.indexOf("<main>"));
    assert.ok(live.body.indexOf("<main>") < live.body.indexOf('id="open-invite"'));
    for (const [label, kind] of [
      ["Invite Player", "filled"],
    ]) {
      const found = live.body.match(new RegExp(`<button[^>]*>${label}</button>`));
      assert.ok(found, label);
      assert.match(found[0], new RegExp(`class="${kind}"`));
    }
    assert.equal(live.body.includes(">Type<"), false);
    assert.equal(live.body.includes(">Select<"), false);
    assert.equal(live.body.includes(">Clear<"), false);
    assert.equal(live.body.includes(">Close<"), false);
    assert.match(live.body, /action="\/session\/select"/);
    assert.match(live.body, /action="\/session\/clear"/);
    assert.match(live.body, /action="\/session\/letter"/);
    assert.match(live.body, /action="\/session\/invite"/);
    assert.equal(live.body.includes("Offer friendship"), false);
    assert.equal(live.body.includes("<h2>Player Status</h2>"), false);
    assert.match(live.body, /name="email"/);
    assert.match(live.body, /name="index"/);
    assert.match(live.body, /name="letter"/);

    const samName = `Sam${Date.now()}`;
    const samEmail = `sam${Date.now()}@example.com`;
    const samSent = await send(port, "POST", "/sign-in", null, { email: samEmail });
    const samMagic = samSent.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const samSigned = await confirmMagicLink(port, samMagic);
    const sam = samSigned.cookie;
    assert.ok(sam);
    await send(port, "POST", "/display-name", sam, { displayName: samName });
    const joined = await send(port, "GET", `/join?invite=${encodeURIComponent(freshInvite)}`, sam);
    assert.equal(joined.status, 303);
    await send(port, "POST", "/session/offer", cookie, { invite: freshInvite, displayName: samName });
    const samLive = await send(port, "GET", sessionPath(freshInvite), sam);
    assert.match(playerStatus(samLive.body), new RegExp(`${displayName} pending`));
    assert.match(playerStatus(samLive.body), /action="\/session\/decline"/);
    const adaLive = await send(port, "GET", sessionPath(freshInvite), cookie);
    assert.match(playerStatus(adaLive.body), new RegExp(`<li class="ink-0"><span class="who">${displayName} <span class="letters">0</span></span></li>`));
    assert.match(playerStatus(adaLive.body), new RegExp(`<span class="who">${samName} <span class="letters">0</span></span>`));
    assert.match(playerStatus(adaLive.body), /title="Offer friendship"/);
    await send(port, "POST", "/session/select", cookie, { invite: freshInvite, index: "0" });
    await send(port, "POST", "/session/select", sam, { invite: freshInvite, index: "2" });
    const adaShades = await send(port, "GET", sessionPath(freshInvite), cookie);
    const samShades = await send(port, "GET", sessionPath(freshInvite), sam);
    assert.match(adaShades.body, /<td class="selected ink-0">/);
    assert.match(adaShades.body, /<td class="ink-1">/);
    assert.match(samShades.body, /<td class="ink-0">/);
    assert.match(samShades.body, /<td class="selected ink-1">/);
    await send(port, "POST", "/session/letter", cookie, { invite: freshInvite, letter: "A" });
    await send(port, "POST", "/session/letter", sam, { invite: freshInvite, letter: "A" });
    const counted = await send(port, "GET", sessionPath(freshInvite), cookie);
    assert.match(playerStatus(counted.body), new RegExp(`<span class="who">${displayName} <span class="letters">1</span></span></li>`));
    assert.match(playerStatus(counted.body), new RegExp(`<span class="who">${samName} <span class="letters">1</span></span>`));
    assert.match(playerStatus(counted.body), /title="Offer friendship"/);
    await send(port, "POST", "/session/offer", sam, { invite: freshInvite, displayName });
    const friends = await send(port, "GET", sessionPath(freshInvite), cookie);
    assert.match(playerStatus(friends.body), /<span class="bond friends" title="Friends">♥<\/span>/);
    assert.match(playerStatus(friends.body), new RegExp(`<button type="submit" class="plain">${samName}</button>`));
    assert.match(playerStatus(friends.body), new RegExp(`name="email" value="${samEmail}"`));
    assert.equal(playerStatus(friends.body).includes("Offer friendship"), false);

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
    assert.match(publishedPost.body, /A Revise link is ready/);
    const publishedHref = publishedPost.body.match(/<a href="([^"]+)">Revise<\/a>/)?.[1] ?? "";
    const published = await send(port, "GET", publishedHref, null);
    assert.equal(published.status, 200);
    assert.match(published.body, new RegExp(`name="title" value="${publishedTitle}"`));
    assert.match(published.body, new RegExp(`name="author" value="${displayName}"`));
    assert.match(published.body, /Version 1/);
    assert.match(published.body, /<button type="submit" name="intent" value="delete">Delete<\/button>/);
    assert.equal(published.body.includes("Start a Session"), false);
    assert.equal(published.body.includes("About Us"), false);
    assert.match(published.body, /<section class="column revise">/);
    assert.equal(published.body.includes("Game"), false);
    const listed = await send(port, "GET", "/published", cookie);
    assert.match(listed.body, new RegExp(`${publishedTitle}`));
    assert.match(listed.body, /Start a Session/);
    const previewHref = listed.body.match(/<a href="([^"]+)">Preview<\/a>/)?.[1]?.replaceAll("&amp;", "&");
    assert.ok(previewHref);
    const preview = await send(port, "GET", previewHref, cookie);
    assert.equal(preview.status, 200);
    assert.match(preview.body, new RegExp(`<h1>${publishedTitle}</h1>`));
    assert.match(preview.body, /<table class="grid">/);
    assert.match(preview.body, /Start a Session/);

    const build = await send(port, "GET", "/build", cookie);
    assert.equal(build.status, 200);
    assert.equal(build.body.split('name="square"').length - 1, 225);
    assert.match(build.body, new RegExp(`name="author" value="${displayName}"`));

    assert.match(build.body, /data-standard-rules hidden/);
    assert.match(build.body, /15×15 or 21×21/);
    const builtTitle = `Built${Date.now()}`;
    const squares = Array.from({ length: 81 }, () => "#");
    squares[0] = "C";
    squares[1] = "A";
    squares[2] = "T";
    squares[9] = "A";
    squares[18] = "R";
    const form = new URLSearchParams();
    form.set("title", builtTitle);
    form.set("author", displayName);
    form.set("kind", "freestyle");
    form.set("size", "9");
    for (const square of squares) form.append("square", square);
    form.append("word", "across-0-0");
    form.append("clue", "A pet");
    form.append("word", "down-0-0");
    form.append("clue", "An automobile");
    form.set("intent", "publish");
    form.set("editEmail", "editor@example.com");
    const built = await send(port, "POST", "/build", cookie, form);
    assert.equal(built.status, 200);
    assert.match(built.body, /A Revise link was sent to editor@example.com/);
    const builtHref = built.body.match(/<a href="([^"]+)">Revise<\/a>/)?.[1] ?? "";
    const builtPage = await send(port, "GET", builtHref, null);
    assert.match(builtPage.body, /A pet/);
    assert.match(builtPage.body, /An automobile/);
    const invalidStandard = new URLSearchParams(form);
    invalidStandard.set("title", `${builtTitle} Standard`);
    invalidStandard.set("kind", "standard");
    const rejectedStandard = await send(port, "POST", "/build", cookie, invalidStandard);
    assert.equal(rejectedStandard.status, 200);
    assert.match(rejectedStandard.body, /data-build-step="clues"/);
    assert.match(rejectedStandard.body, /Standard Crosswords must be 15×15 or 21×21/);
    assert.equal(rejectedStandard.body.includes("A Revise link is ready."), false);
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
    const signed = await confirmMagicLink(port, magic);
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

    const blankPost = await send(port, "POST", "/publish", cookie, { author: "", crossword: JSON.stringify(blankCrossword) });
    const namedPost = await send(port, "POST", "/publish", cookie, { author: "Ada", crossword: JSON.stringify(namedCrossword) });
    const standardPost = await send(port, "POST", "/publish", cookie, { author: "Ada", crossword: JSON.stringify(standardCrossword) });
    assert.equal(blankPost.status, 200);
    assert.equal(namedPost.status, 200);
    assert.equal(standardPost.status, 200);
    const hrefOf = (body: string) => body.match(/<a href="([^"]+)">Revise<\/a>/)?.[1] ?? "";

    const blank = await send(port, "GET", hrefOf(blankPost.body), null);
    assert.equal(blank.status, 200);
    assert.match(blank.body, new RegExp(`name="title" value="${title}"`));
    assert.match(blank.body, /name="author" value=""/);
    assert.match(blank.body, /value="C"/);
    assert.match(blank.body, /value="A"/);
    assert.match(blank.body, /value="T"/);
    assert.match(blank.body, /value="D"/);
    assert.match(blank.body, /value="O"/);
    assert.match(blank.body, /value="G"/);
    assert.match(blank.body, /value="#"/);
    assert.match(blank.body, /value="Feline"/);
    assert.match(blank.body, /value="Hound"/);
    assert.match(blank.body, /Version 1/);
    assert.equal(blank.body.includes('value="no Author"'), false);
    assert.equal(blank.body.includes("Start a Session"), false);
    assert.match(blank.body, /<button type="submit" name="intent" value="delete">Delete<\/button>/);

    const named = await send(port, "GET", hrefOf(namedPost.body), null);
    assert.equal(named.status, 200);
    assert.match(named.body, /name="author" value="Ada"/);
    assert.match(named.body, /value="Nine As"/);
    const standard = await send(port, "GET", hrefOf(standardPost.body), null);
    assert.equal(standard.status, 200);
    assert.match(standard.body, new RegExp(`name="title" value="${standardTitle}"`));
    assert.match(standard.body, /value="A"/);
    assert.equal(standard.body.includes('value="#"'), false);
    assert.match(standard.body, /value="Across 1"/);
    assert.match(standard.body, /value="Down 1"/);
    assert.match(standard.body, /value="Across 15"/);
    assert.match(standard.body, /value="Down 15"/);
    assert.match(standard.body, /name="author" value="Ada"/);

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

test("a Session stream updates the other Player, keeps Presence across a reload, and clears it when the stream stays closed", async () => {
  const port = await freePort();
  const child = await startServer(port);
  const sessionPath = (invite: string) => `/session?invite=${encodeURIComponent(invite)}`;
  let adaStream: Watch | undefined;
  let samStream: Watch | undefined;
  let rejoined: Watch | undefined;
  try {
    const ada = await signIn(port, "Ada");
    const sam = await signIn(port, "Sam");
    const bea = await signIn(port, "Bea");
    const started = await send(port, "POST", "/session", ada, { title: "First Row" });
    const invite = new URL(started.location ?? "", "http://localhost").searchParams.get("invite") ?? "";
    assert.equal(started.status, 303);
    const joined = await send(port, "GET", `/join?invite=${encodeURIComponent(invite)}`, sam);
    assert.equal(joined.status, 303);
    adaStream = await watchSession(port, invite, ada);
    samStream = await watchSession(port, invite, sam);
    assert.equal(adaStream.status, 200);
    assert.match(adaStream.type, /text\/event-stream/);
    await adaStream.untilOpen();
    await samStream.untilOpen();

    const selected = await send(port, "POST", "/session/select", ada, { invite, index: "0" });
    assert.equal(selected.status, 303);
    await samStream.untilCount(1);
    const typed = await send(port, "POST", "/session/letter", ada, { invite, letter: "A" });
    assert.equal(typed.status, 303);
    await samStream.untilCount(2);
    const samSeen = await send(port, "GET", sessionPath(invite), sam);
    assert.equal(squareClass(samSeen.body, "0"), "ink-0");
    assert.match(samSeen.body, /<span class=\"letter\">A<\/span>/);

    const beforeSam = samStream.events();
    await send(port, "POST", "/session/select", sam, { invite, index: "2" });
    await samStream.untilCount(beforeSam + 1);
    const beforeMove = samStream.events();
    adaStream.stop();
    const moved = await send(port, "POST", "/session/select", ada, { invite, index: "1" });
    assert.equal(moved.status, 303);
    rejoined = await watchSession(port, invite, ada);
    await rejoined.untilOpen();
    await samStream.untilCount(beforeMove + 1);
    const settled = samStream.events();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(samStream.events(), settled);
    const kept = await send(port, "GET", sessionPath(invite), ada);
    assert.equal(squareClass(kept.body, "1"), "selected ink-0");
    const samKept = await send(port, "GET", sessionPath(invite), sam);
    assert.equal(squareClass(samKept.body, "1"), "ink-0");
    assert.equal(squareClass(samKept.body, "2"), "selected ink-1");

    const marked = samStream.events();
    rejoined.stop();
    const anon = await watchSession(port, invite, null);
    assert.equal(anon.status, 401);
    assert.equal(anon.type.includes("text/event-stream"), false);
    assert.equal(anon.text().includes("<h1>First Row</h1>"), false);
    assert.equal(anon.text().includes('<span class="letter">A</span>'), false);
    const outsider = await watchSession(port, invite, bea);
    assert.equal(outsider.status, 404);
    assert.equal(outsider.type.includes("text/event-stream"), false);
    assert.equal(outsider.text().includes('<span class="letter">A</span>'), false);
    await samStream.untilCount(marked + 1);
    const cleared = await send(port, "GET", sessionPath(invite), sam);
    assert.equal(squareClass(cleared.body, "0"), "");
    assert.equal(squareClass(cleared.body, "1"), "");
    assert.equal(squareClass(cleared.body, "2"), "selected ink-1");
    assert.match(cleared.body, /<span class=\"letter\">A<\/span>/);
    const adaCleared = await send(port, "GET", sessionPath(invite), ada);
    assert.equal(adaCleared.body.includes("selected"), false);
    assert.match(playerStatus(adaCleared.body), /Ada/);
    assert.match(playerStatus(adaCleared.body), /Sam/);
  } finally {
    adaStream?.stop();
    samStream?.stop();
    rejoined?.stop();
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
});

test("a new Crossword keeps its grid and clues across the Build steps and publishes the final text", async () => {
  const port = await freePort();
  const child = await startServer(port);
  const stamp = Date.now();
  const draftTitle = `Draft${stamp}`;
  const finalTitle = `Published${stamp}`;
  const size = 9;
  const squares = Array.from({ length: size * size }, () => "#");
  const put = (row: number, column: number, letter: string) => {
    squares[row * size + column] = letter;
  };
  for (const [column, letter] of [..."CAT"].entries()) put(0, column, letter);
  for (const [column, letter] of [..."DOG"].entries()) put(0, 4 + column, letter);
  put(1, 0, "A");
  put(2, 0, "R");
  put(1, 4, "O");
  put(2, 4, "G");
  const clueText = ["A pet", "Hound", "Automobile", "Puppy"];
  const wordKeys = ["across-0-0", "across-0-4", "down-0-0", "down-0-4"];
  const form = (intent: string, clues: string[], title: string) => {
    const body = new URLSearchParams();
    body.set("title", title);
    body.set("author", "Ada");
    body.set("kind", "freestyle");
    body.set("size", String(size));
    for (const square of squares) body.append("square", square);
    wordKeys.forEach((key, index) => {
      const clue = clues[index];
      if (clue === undefined) return;
      body.append("word", key);
      body.append("clue", clue);
    });
    body.set("intent", intent);
    return body;
  };
  try {
    const cookie = await signIn(port, "Ada");
    const script = await send(port, "GET", "/build.js", null);
    assert.equal(script.status, 200);
    assert.match(script.type, /javascript/);
    assert.ok(script.body.length > 0);

    const grid = await send(port, "GET", "/build", cookie);
    assert.equal(grid.status, 200);
    assert.match(grid.body, /<form class="build" method="post" action="\/build" data-build-step="grid">/);
    assert.match(grid.body, /<script type="module" src="\/build.js"><\/script>/);
    assert.match(grid.body, /<button type="submit" class="filled" name="intent" value="clues">Continue to clues<\/button>/);
    assert.match(grid.body, /<input name="size" type="number" min="9" max="21" value="15" required>/);
    assert.equal(grid.body.split('name="square"').length - 1, 225);
    assert.equal(grid.body.includes('name="clue"'), false);
    assert.equal(grid.body.includes('name="intent" value="publish"'), false);
    assert.equal(grid.body.includes("readonly"), false);

    const clues = await send(port, "POST", "/build", cookie, form("clues", [], draftTitle));
    assert.equal(clues.status, 200);
    assert.match(clues.body, /data-build-step="clues"/);
    assert.match(clues.body, /<input type="hidden" name="size" value="9">/);
    assert.equal(clues.body.includes('type="number"'), false);
    assert.equal(clues.body.split("readonly").length - 1, 81);
    assert.equal(clues.body.split('<td class="block">').length - 1, 71);
    assert.match(clues.body, /<td><span class="number">1<\/span><input name="square" maxlength="1" value="C" aria-label="Row 1 column 1" readonly>/);
    assert.match(clues.body, /<td><span class="number">2<\/span><input name="square" maxlength="1" value="D" aria-label="Row 1 column 5" readonly>/);
    assert.equal(clues.body.includes('<span class="number">3</span>'), false);
    assert.equal(clues.body.split('name="clue"').length - 1, 4);
    assert.match(clues.body, /<textarea class="build-clue-editor" name="clue" rows="3" aria-label="1 Across clue" data-build-clue-editor hidden><\/textarea>/);
    assert.match(clues.body, new RegExp(`name="title" value="${draftTitle}"`));
    assert.match(clues.body, /name="author" value="Ada"/);
    assert.match(clues.body, /<button type="submit" class="plain" name="intent" value="back"\s*>Back<\/button>/);
    assert.match(clues.body, /<button type="submit" class="filled" name="intent" value="publish">Publish<\/button>/);
    assert.equal(clues.body.includes("Continue to clues"), false);

    const back = await send(port, "POST", "/build", cookie, form("back", clueText, draftTitle));
    assert.equal(back.status, 200);
    assert.match(back.body, /data-build-step="grid"/);
    assert.match(back.body, /<td><span class="number">1<\/span><input name="square" maxlength="1" value="C" aria-label="Row 1 column 1">/);
    assert.match(back.body, new RegExp(`name="title" value="${draftTitle}"`));
    assert.match(back.body, /name="author" value="Ada"/);
    assert.match(back.body, /<option value="freestyle" selected>/);
    assert.match(back.body, /<input name="size" type="number" min="9" max="21" value="9" required>/);
    assert.match(back.body, /<input type="hidden" name="word" value="across-0-0">\s*<input type="hidden" name="clue" value="A pet">/);
    assert.match(back.body, /<input type="hidden" name="clue" value="Hound">/);
    assert.match(back.body, /<input type="hidden" name="clue" value="Automobile">/);
    assert.match(back.body, /<input type="hidden" name="clue" value="Puppy">/);
    assert.equal(back.body.includes("readonly"), false);
    assert.match(back.body, /Continue to clues/);

    const kept = await send(port, "POST", "/build", cookie, form("clues", clueText, draftTitle));
    assert.match(kept.body, /data-build-step="clues"/);
    assert.match(kept.body, /<span data-clue-text>A pet<\/span>/);
    assert.match(kept.body, /<span data-clue-text>Hound<\/span>/);
    assert.match(kept.body, /<span data-clue-text>Automobile<\/span>/);
    assert.match(kept.body, /<span data-clue-text>Puppy<\/span>/);

    const published = await send(port, "POST", "/build", cookie, form("publish", ["A pet", "Wolf", "Automobile", "Puppy"], finalTitle));
    assert.equal(published.status, 200);
    assert.match(published.body, /A Revise link is ready/);
    const href = published.body.match(/<a href="([^"]+)">Revise<\/a>/)?.[1] ?? "";
    const revise = await send(port, "GET", href, null);
    assert.equal(revise.status, 200);
    assert.match(revise.body, /data-build-step="edit"/);
    assert.match(revise.body, new RegExp(`name="title" value="${finalTitle}"`));
    assert.equal(revise.body.includes(`value="${draftTitle}"`), false);
    assert.match(revise.body, /value="A pet"/);
    assert.match(revise.body, /value="Wolf"/);
    assert.equal(revise.body.includes('value="Hound"'), false);
    assert.match(revise.body, /value="Automobile"/);
    assert.match(revise.body, /value="Puppy"/);
    assert.match(revise.body, /value="C"/);
    assert.match(revise.body, /<button type="submit" name="intent" value="layout">Update grid<\/button>/);
    assert.match(revise.body, /<button type="submit" class="filled" name="intent" value="publish">Publish<\/button>/);
    assert.equal(revise.body.includes("readonly"), false);
    assert.match(revise.body, /<button type="submit" name="intent" value="delete">Delete<\/button>/);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
});

test("changing Build size keeps the overlapping squares and the clues at those coordinates", async () => {
  const port = await freePort();
  const child = await startServer(port);
  const nine = Array.from({ length: 81 }, () => "#");
  nine[0] = "c";
  nine[1] = "A";
  nine[2] = "T";
  nine[9] = "A";
  nine[18] = "R";
  nine[80] = "Z";
  const fifteen = Array.from({ length: 225 }, () => "#");
  for (let row = 0; row < 9; row++) {
    for (let column = 0; column < 9; column++) fifteen[row * 15 + column] = nine[row * 9 + column];
  }
  fifteen[10] = "Q";
  fifteen[11] = "Q";
  const post = (size: string, squares: string[], outside: boolean) => {
    const body = new URLSearchParams();
    body.set("title", "Resize");
    body.set("author", "Ada");
    body.set("kind", "freestyle");
    body.set("size", size);
    for (const square of squares) body.append("square", square);
    body.append("word", "across-0-0");
    body.append("clue", "A pet");
    body.append("word", "down-0-0");
    body.append("clue", "An automobile");
    if (outside) {
      body.append("word", "across-0-10");
      body.append("clue", "Outside");
    }
    body.set("intent", "clues");
    return body;
  };
  try {
    const cookie = await signIn(port, "Ada");
    const expanded = await send(port, "POST", "/build", cookie, post("15", nine, false));
    assert.equal(expanded.status, 200);
    assert.equal(expanded.body.split('name="square"').length - 1, 225);
    assert.match(expanded.body, /value="C" aria-label="Row 1 column 1" readonly/);
    assert.match(expanded.body, /value="#" aria-label="Row 1 column 4" readonly/);
    assert.match(expanded.body, /value="Z" aria-label="Row 9 column 9" readonly/);
    assert.match(expanded.body, /value="" aria-label="Row 1 column 10" readonly/);
    assert.match(expanded.body, /<span data-clue-text>A pet<\/span>/);
    assert.match(expanded.body, /<span data-clue-text>An automobile<\/span>/);

    const shrunk = await send(port, "POST", "/build", cookie, post("9", fifteen, true));
    assert.equal(shrunk.status, 200);
    assert.equal(shrunk.body.split('name="square"').length - 1, 81);
    assert.match(shrunk.body, /value="C" aria-label="Row 1 column 1" readonly/);
    assert.match(shrunk.body, /value="Z" aria-label="Row 9 column 9" readonly/);
    assert.equal(shrunk.body.includes('value="Q"'), false);
    assert.equal(shrunk.body.includes("column 10"), false);
    assert.equal(shrunk.body.includes("Outside"), false);
    assert.match(shrunk.body, /<span data-clue-text>A pet<\/span>/);
    assert.match(shrunk.body, /<span data-clue-text>An automobile<\/span>/);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  }
});

test("a request body over 256 KiB is rejected with 413 and does not issue a magic link", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const oversizeEmail = `oversize-${Date.now()}@example.com`;
    const oversize = await sendBytes(port, "/sign-in", formBody(oversizeEmail, maxBodyBytes + 1));
    assert.equal(oversize.status, 413);
    assert.equal(oversize.cookie, null);
    assert.doesNotMatch(oversize.body, /\/magic\?token=/);
    assert.doesNotMatch(oversize.body, /Open magic link/);

    const boundaryEmail = `boundary-${Date.now()}@example.com`;
    const boundary = formBody(boundaryEmail, maxBodyBytes);
    assert.equal(Buffer.byteLength(boundary), maxBodyBytes);
    const atLimit = await sendBytes(port, "/sign-in", boundary);
    assert.notEqual(atLimit.status, 413);
    assert.match(atLimit.body, /Open magic link/);
    assert.match(atLimit.body, /\/magic\?token=/);

    const chunked = await sendChunked(port, "/sign-in", [
      formBody(`chunked-${Date.now()}@example.com`, maxBodyBytes - 1000),
      "x".repeat(2000),
    ]);
    assert.equal(chunked.status, 413);
    assert.equal(chunked.cookie, null);
    assert.doesNotMatch(chunked.body, /\/magic\?token=/);

    const fresh = await send(port, "POST", "/sign-in", null, { email: `fresh-${Date.now()}@example.com` });
    assert.equal(fresh.status, 200);
    assert.match(fresh.body, /Open magic link/);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("a chunked body over 256 KiB is rejected with 413 before a body-free route runs", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const cookie = await signIn(port, "chunk-sign-out");
    const oversize = await sendChunked(port, "/sign-out", ["x".repeat(maxBodyBytes + 1)], cookie);
    assert.equal(oversize.status, 413);
    assert.equal(oversize.setCookie, null);
    assertAppSecurityHeaders(oversize);
    assert.match(oversize.body, /That request is too large/);
    const stillIn = await send(port, "GET", "/", cookie);
    assert.equal(stillIn.status, 200);
    assert.doesNotMatch(stillIn.body, /action="\/sign-in"/);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("a repeated sign-in for the same address within 60 seconds returns 429 with Retry-After and identical feedback for known and unknown addresses", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const knownEmail = `known-${Date.now()}@example.com`;
    const unknownEmail = `unknown-${Date.now()}@example.com`;
    const firstKnown = await send(port, "POST", "/sign-in", null, { email: knownEmail });
    assert.equal(firstKnown.status, 200);
    assert.match(firstKnown.body, /Open magic link/);
    const magic = firstKnown.body.match(/<a href="([^"]+)">/)?.[1] ?? "";
    const signed = await confirmMagicLink(port, magic);
    assert.equal(signed.status, 303);

    const limitedKnown = await send(port, "POST", "/sign-in", null, { email: knownEmail });
    assert.equal(limitedKnown.status, 429);
    assert.match(limitedKnown.body, /Too many sign-in emails\. Try again in (\d+) seconds\./);
    const knownSeconds = limitedKnown.body.match(/Try again in (\d+) seconds/)?.[1] ?? "";
    assert.equal(limitedKnown.retryAfter, knownSeconds);
    assert.ok(Number(knownSeconds) >= 1 && Number(knownSeconds) <= 60);
    assert.doesNotMatch(limitedKnown.body, /\/magic\?token=/);
    assert.equal(limitedKnown.cookie, null);

    const firstUnknown = await send(port, "POST", "/sign-in", null, { email: unknownEmail });
    assert.equal(firstUnknown.status, 200);
    const limitedUnknown = await send(port, "POST", "/sign-in", null, { email: unknownEmail });
    assert.equal(limitedUnknown.status, 429);
    assert.match(limitedUnknown.body, /Too many sign-in emails\. Try again in (\d+) seconds\./);
    assert.equal(limitedUnknown.retryAfter, limitedUnknown.body.match(/Try again in (\d+) seconds/)?.[1] ?? null);
    assert.equal(limitedKnown.body.includes(knownEmail), false);
    assert.equal(limitedUnknown.body.includes(unknownEmail), false);
    assert.equal(
      limitedKnown.body.replace(/Try again in \d+ seconds/, "Try again in N seconds"),
      limitedUnknown.body.replace(/Try again in \d+ seconds/, "Try again in N seconds"),
    );
    assert.doesNotMatch(limitedUnknown.body, /\/magic\?token=/);
  } finally {
    child.kill();
    await once(child, "exit");
  }
});

test("the fifty-first distinct sign-in address within an hour returns 429 and leaves in-limit sign-in unchanged on a fresh server", async () => {
  const port = await freePort();
  const child = await startServer(port);
  try {
    const stamp = Date.now();
    for (let index = 0; index < 50; index += 1) {
      const issued = await send(port, "POST", "/sign-in", null, { email: `global-${stamp}-${index}@example.com` });
      assert.equal(issued.status, 200, `issuance ${index}`);
      assert.match(issued.body, /Open magic link/);
    }
    const limited = await send(port, "POST", "/sign-in", null, { email: `global-${stamp}-overflow@example.com` });
    assert.equal(limited.status, 429);
    assert.match(limited.body, /Too many sign-in emails\. Try again in (\d+) seconds\./);
    assert.equal(limited.retryAfter, limited.body.match(/Try again in (\d+) seconds/)?.[1] ?? null);
    assert.doesNotMatch(limited.body, /\/magic\?token=/);
  } finally {
    child.kill();
    await once(child, "exit");
  }

  const freshPort = await freePort();
  const fresh = await startServer(freshPort);
  try {
    const ok = await send(freshPort, "POST", "/sign-in", null, { email: `fresh-${Date.now()}@example.com` });
    assert.equal(ok.status, 200);
    assert.match(ok.body, /Open magic link/);
    assert.equal(ok.retryAfter, null);
  } finally {
    fresh.kill();
    await once(fresh, "exit");
  }
});

test("production startup fails fast when required config is missing", async () => {
  const failed = await startServerExpectExit({
    NODE_ENV: "production",
    DATABASE_URL: "",
    PUBLIC_URL: "",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
  });
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /Missing required configuration: DATABASE_URL, PUBLIC_URL, SMTP_USER, SMTP_PASSWORD/);
  assert.doesNotMatch(failed.output, /Co-opword listening/);
});

test("production startup rejects invalid PUBLIC_URL without printing its value", async () => {
  const publicUrl = "http://insecure.example/path";
  const failed = await startServerExpectExit({
    NODE_ENV: "production",
    DATABASE_URL: "sqlite:/unused.sqlite",
    PUBLIC_URL: publicUrl,
    SMTP_USER: "mailer@example.test",
    SMTP_PASSWORD: "smtp-password-value",
  });
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /Invalid configuration: PUBLIC_URL/);
  assert.equal(failed.output.includes(publicUrl), false);
  assert.equal(failed.output.includes("smtp-password-value"), false);
});

test("production startup rejects invalid port and SMTP transport settings", async () => {
  const invalidValues: [string, string][] = [
    ["PORT", "65536"],
    ["SMTP_PORT", "0"],
    ["SMTP_SECURE", "yes"],
  ];
  for (const [name, value] of invalidValues) {
    const failed = await startServerExpectExit({
      NODE_ENV: "production",
      DATABASE_URL: "sqlite:/unused.sqlite",
      PUBLIC_URL: "https://coopword.example.test",
      SMTP_USER: "mailer@example.test",
      SMTP_PASSWORD: "smtp-password-value",
      [name]: value,
    });
    assert.notEqual(failed.code, 0);
    assert.ok(failed.output.includes(`Invalid configuration: ${name}`));
    assert.equal(failed.output.includes(value), false);
  }
});

test("production startup rejects in-memory SQLite", async () => {
  const secret = "smtp-memory-secret";
  const failed = await startServerExpectExit({
    NODE_ENV: "production",
    DATABASE_URL: "sqlite::memory:",
    PUBLIC_URL: "https://coopword.example.test",
    SMTP_USER: "mailer@example.test",
    SMTP_PASSWORD: secret,
  });
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /Invalid configuration: DATABASE_URL/);
  assert.equal(failed.output.includes(secret), false);
});

test("production startup succeeds with required config and does not contact SMTP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coopword-production-"));
  const dbPath = join(dir, "coopword.sqlite").replaceAll("\\", "/");
  const port = await freePort();
  const started = await startServerProcess(port, {
    NODE_ENV: "production",
    DATABASE_URL: `sqlite:${dbPath}`,
    PUBLIC_URL: "https://coopword.example.test",
    SMTP_USER: "mailer@example.test",
    SMTP_PASSWORD: "smtp-password-value",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1",
    SMTP_SECURE: "false",
  });
  try {
    assert.match(started.output(), /Co-opword listening/);
    assert.equal(started.output().includes("smtp-password-value"), false);
    const health = await getHealth(port);
    assert.equal(health.status, 200);
    assert.equal(health.body, "healthy");
  } finally {
    started.child.kill();
    await once(started.child, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /health reports healthy or unhealthy status without diagnostics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coopword-health-"));
  const dbPath = join(dir, "coopword.sqlite").replaceAll("\\", "/");
  const port = await freePort();
  const child = await startServer(port, { DATABASE_URL: `sqlite:${dbPath}` });
  try {
    const healthy = await getHealth(port);
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body, "healthy");
    assert.match(healthy.type, /text\/plain/);
    assert.equal(healthy.body.includes(dbPath), false);
    assert.equal(healthy.body.toLowerCase().includes("sqlite"), false);
    assert.equal(healthy.body.includes(dir), false);

    const db = new DatabaseSync(dbPath);
    db.exec("DROP TABLE snapshot_store");
    db.close();

    const unhealthy = await getHealth(port);
    assert.equal(unhealthy.status, 503);
    assert.equal(unhealthy.body, "unhealthy");
    assert.match(unhealthy.type, /text\/plain/);
    assert.equal(unhealthy.body.includes(dbPath), false);
    assert.equal(unhealthy.body.toLowerCase().includes("sqlite"), false);
    assert.equal(unhealthy.body.includes("Error"), false);
    assert.equal(unhealthy.body.includes(dir), false);
  } finally {
    child.kill();
    await once(child, "exit");
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "SIGTERM drains an in-flight write, closes SSE, and exits within 30 seconds",
  { skip: process.platform === "win32" ? "Windows does not deliver SIGTERM to child process handlers" : false },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "coopword-shutdown-"));
    const dbPath = join(dir, "coopword.sqlite").replaceAll("\\", "/");
    const port = await freePort();
    const started = await startServerProcess(port, { DATABASE_URL: `sqlite:${dbPath}` });
    const child = started.child;
    const exited = once(child, "exit");
    const began = Date.now();
    try {
      const cookie = await signIn(port, "shutdown");
      const startedSession = await send(port, "POST", "/session", cookie, { title: "First Row" });
      const invite = new URL(startedSession.location ?? "", "http://localhost").searchParams.get("invite") ?? "";
      assert.ok(invite);
      await send(port, "POST", "/session/select", cookie, { invite, index: "0" });
      const stream = await watchSession(port, invite, cookie);
      await stream.untilOpen();

      const write = sendDuringShutdown(
        port,
        "/session/letter",
        cookie,
        new URLSearchParams({ invite, index: "0", letter: "A" }),
        async () => {
          const shutdownLog = once(child.stdout!, "data").then(([chunk]) => chunk);
          const exitedEarly = exited.then(() => {
            throw new Error("server exited before beginning shutdown");
          });
          assert.equal(child.kill("SIGTERM"), true);
          const chunk = await Promise.race([shutdownLog, exitedEarly]);
          assert.match(chunk.toString(), /Received SIGTERM, shutting down/);
        },
      );
      const written = await write;
      assert.equal(written.status, 303);
      await stream.untilClosed();

      const [code] = await exited;
      assert.equal(code, 0);
      assert.ok(Date.now() - began < 30_000);
      assert.match(started.output(), /Shutdown complete/);

      const db = new DatabaseSync(dbPath);
      const row = db.prepare("SELECT snapshot FROM snapshot_store WHERE id = 1").get() as { snapshot: string } | undefined;
      db.close();
      assert.match(row?.snapshot ?? "", /"letters":\["A"/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

