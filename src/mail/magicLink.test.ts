import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deliverLink } from "./magicLink.ts";

const envKeys = ["NODE_ENV", "RESEND_API_KEY", "EMAIL_FROM", "PUBLIC_ORIGIN"] as const;

async function withEnvironment(values: Partial<Record<(typeof envKeys)[number], string>>, run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
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
    globalThis.fetch = originalFetch;
  }
}

test("development records the link token in the local outbox", async () => {
  await withEnvironment({ NODE_ENV: "test" }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "coopword-mail-"));
    try {
      const outboxPath = join(directory, "magic.jsonl");
      await deliverLink(outboxPath, "player@example.test", "one-time-token", "/magic?token=one-time-token");
      assert.deepEqual(JSON.parse(readFileSync(outboxPath, "utf8")), {
        email: "player@example.test",
        token: "one-time-token",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("production sends an absolute HTTPS link through Resend", async () => {
  await withEnvironment({
    NODE_ENV: "production",
    RESEND_API_KEY: "test-api-key",
    EMAIL_FROM: "Co-opword <play@example.test>",
    PUBLIC_ORIGIN: "https://coopword.example.test",
  }, async () => {
    const directory = mkdtempSync(join(tmpdir(), "coopword-mail-"));
    try {
      const outboxPath = join(directory, "unused.jsonl");
      let request: { url: string; init?: RequestInit } | undefined;
      globalThis.fetch = async (input, init) => {
        request = { url: String(input), init };
        return new Response(null, { status: 200 });
      };

      await deliverLink(outboxPath, "player@example.test", "secret-token", "/magic?token=secret-token");

      assert.ok(request);
      assert.equal(request.url, "https://api.resend.com/emails");
      assert.equal(new Headers(request.init?.headers).get("authorization"), "Bearer test-api-key");
      assert.deepEqual(JSON.parse(String(request.init?.body)), {
        from: "Co-opword <play@example.test>",
        to: ["player@example.test"],
        subject: "Your Co-opword link",
        text: "Open this Co-opword link: https://coopword.example.test/magic?token=secret-token",
      });
      assert.equal(existsSync(outboxPath), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("production reports missing mail configuration and rejected delivery", async () => {
  await withEnvironment({ NODE_ENV: "production" }, async () => {
    await assert.rejects(
      deliverLink("unused.jsonl", "player@example.test", "secret-token", "/magic?token=secret-token"),
      /RESEND_API_KEY/,
    );
  });

  await withEnvironment({
    NODE_ENV: "production",
    RESEND_API_KEY: "test-api-key",
    EMAIL_FROM: "play@example.test",
    PUBLIC_ORIGIN: "https://coopword.example.test",
  }, async () => {
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(
      deliverLink("unused.jsonl", "player@example.test", "secret-token", "/magic?token=secret-token"),
      /Resend rejected email/,
    );
  });
});
