import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deliverLink } from "./magicLink.ts";

const envKeys = ["NODE_ENV", "SMTP_USER", "SMTP_PASSWORD", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "MAIL_FROM", "PUBLIC_URL"] as const;

async function withEnvironment(values: Partial<Record<(typeof envKeys)[number], string>>, run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    await run();
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("development records the link token in the local outbox", async () => {
  await withEnvironment({ NODE_ENV: "test" }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "coopword-mail-"));
    const outboxPath = join(directory, "magic.jsonl");
    try {
      assert.equal(await deliverLink(outboxPath, "player@example.test", "one-time-token", "/magic?token=one-time-token"), "outbox");
      assert.deepEqual(JSON.parse(readFileSync(outboxPath, "utf8")), {
        email: "player@example.test",
        token: "one-time-token",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("production requires SMTP credentials instead of writing links to a local outbox", async () => {
  await withEnvironment({ NODE_ENV: "production" }, async () => {
    await assert.rejects(
      deliverLink("unused.jsonl", "player@example.test", "secret-token", "/magic?token=secret-token"),
      /SMTP_USER and SMTP_PASSWORD are required/,
    );
  });
});

test("configured SMTP sends a styled email with an absolute link", async () => {
  const received: string[] = [];
  const server = createServer((socket) => {
    let input = "";
    let inData = false;
    socket.write("220 test server\r\n");
    socket.on("data", (chunk) => {
      input += chunk.toString();
      while (input.includes("\r\n")) {
        const end = input.indexOf("\r\n");
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 queued\r\n");
          } else {
            received.push(line);
          }
        } else if (line.startsWith("EHLO ")) {
          socket.write("250-test server\r\n250 AUTH PLAIN LOGIN\r\n");
        } else if (line.startsWith("AUTH ")) {
          socket.write("235 authenticated\r\n");
        } else if (line.startsWith("MAIL FROM:") || line.startsWith("RCPT TO:")) {
          socket.write("250 accepted\r\n");
        } else if (line === "DATA") {
          inData = true;
          socket.write("354 continue\r\n");
        } else if (line === "QUIT") {
          socket.write("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await withEnvironment({
      NODE_ENV: "production",
      SMTP_USER: "mailer@example.test",
      SMTP_PASSWORD: "test-password",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(address.port),
      SMTP_SECURE: "false",
      MAIL_FROM: "Co-opword <mailer@example.test>",
      PUBLIC_URL: "https://coopword.example.test",
    }, async () => {
      assert.equal(
        await deliverLink("unused.jsonl", "player@example.test", "safe-token", "/magic?token=safe-token", "Sign in <today>"),
        "smtp",
      );
    });
    const message = received.join("\n").replace(/=\r?\n/g, "");
    assert.match(message, /mailer@example\.test/);
    assert.match(message, /player@example\.test/);
    assert.match(message, /https:\/\/coopword\.example\.test\/magic\?token=safe-token/);
    assert.match(message, /background-color:/);
    assert.match(message, /font-family:Georgia/);
    assert.match(message, /Continue to Co-opword/);
    assert.match(message, /Sign in &lt;today&gt;/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
