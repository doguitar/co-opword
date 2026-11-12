import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { backupDatabase } from "./backup.ts";
import { openSnapshotStore } from "./snapshotStore.ts";

function dataDirectory(): string {
  return mkdtempSync(join(tmpdir(), "coopword-backup-"));
}

function sqliteUrl(path: string): string {
  return `sqlite:${path.replaceAll("\\", "/")}`;
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function seedLiveDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS letters (id INTEGER PRIMARY KEY, mark TEXT NOT NULL CHECK (length(mark) > 0))",
  );
  db.prepare("INSERT INTO letters (mark) VALUES (?)").run("before");
  return db;
}

function insertCheckViolation(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA ignore_check_constraints=ON");
  db.prepare("INSERT INTO letters (mark) VALUES (?)").run("");
  db.exec("PRAGMA ignore_check_constraints=OFF");
  db.close();
}

test("online backup allows live writes and reopens with a consistent view", async () => {
  const dir = dataDirectory();
  const databasePath = join(dir, "coopword.sqlite");
  const store = await openSnapshotStore(sqliteUrl(databasePath), dir);
  await store.write("before");

  const live = new DatabaseSync(databasePath);
  live.exec("CREATE TABLE backup_payload (value TEXT NOT NULL)");
  live.exec("BEGIN");
  const insert = live.prepare("INSERT INTO backup_payload (value) VALUES (?)");
  for (let i = 0; i < 10_000; i++) insert.run("x".repeat(1024));
  live.exec("COMMIT");
  live.close();

  const writerCode = `
    const { DatabaseSync } = require("node:sqlite");
    process.stdout.write("READY");
    process.stdin.once("data", () => {
      const db = new DatabaseSync(${JSON.stringify(databasePath)});
      try {
        db.prepare("UPDATE snapshot_store SET snapshot = ? WHERE id = 1").run("after");
        process.stdout.write("WRITE:OK");
      } catch (error) {
        process.stdout.write("WRITE:FAIL:" + error.message);
        process.exitCode = 1;
      } finally {
        db.close();
      }
    });
  `;
  const writer = spawn(process.execPath, ["-e", writerCode], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let writerOutput = "";
  let resolveReady: () => void = () => {};
  const writerReady = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  writer.stdout.setEncoding("utf8").on("data", (chunk) => {
    writerOutput += chunk;
    if (writerOutput.includes("READY")) resolveReady();
  });
  const writerClosed = once(writer, "close");
  await writerReady;

  const pending = backupDatabase({
    dataDir: dir,
    databaseUrl: sqliteUrl(databasePath),
    now: new Date("2026-05-01T10:00:00.000Z"),
  });
  writer.stdin.end("write");
  const result = await pending;
  const [exitCode] = await writerClosed;
  assert.equal(exitCode, 0, writerOutput);
  assert.match(writerOutput, /WRITE:OK/);
  assert.match(result.path, /coopword-2026-05-01T10-00-00Z\.sqlite$/);
  assert.equal(await store.read(), "after");

  const restored = new DatabaseSync(result.path, { readOnly: true });
  try {
    const row = restored.prepare("SELECT snapshot FROM snapshot_store WHERE id = 1").get() as
      | { snapshot: string }
      | undefined;
    assert.ok(row !== undefined);
    assert.ok(["before", "after"].includes(row.snapshot));
    const count = restored.prepare("SELECT COUNT(*) AS count FROM backup_payload").get() as { count: number };
    assert.equal(count.count, 10_000);
  } finally {
    restored.close();
  }
});

test("quick_check failure removes only the new destination and keeps live data and prior backups", async () => {
  const dir = dataDirectory();
  const databasePath = join(dir, "coopword.sqlite");
  const live = seedLiveDatabase(databasePath);
  live.exec("PRAGMA journal_mode = WAL");
  live.close();

  const good = await backupDatabase({
    dataDir: dir,
    databaseUrl: sqliteUrl(databasePath),
    now: new Date("2026-05-01T10:00:00.000Z"),
  });
  const backupsDir = dirname(good.path);
  const priorNames = readdirSync(backupsDir).sort();
  assert.deepEqual(priorNames, ["coopword-2026-05-01T10-00-00Z.sqlite"]);

  insertCheckViolation(databasePath);
  const liveDigest = digest(databasePath);

  await assert.rejects(
    () =>
      backupDatabase({
        dataDir: dir,
        databaseUrl: sqliteUrl(databasePath),
        now: new Date("2026-05-01T11:00:00.000Z"),
      }),
    /quick_check/,
  );

  assert.equal(digest(databasePath), liveDigest);
  assert.deepEqual(readdirSync(backupsDir).sort(), priorNames);
  assert.equal(existsSync(join(backupsDir, "coopword-2026-05-01T11-00-00Z.sqlite")), false);
});

test("unsafe labels are rejected before filesystem changes", async () => {
  const dir = dataDirectory();
  const databasePath = join(dir, "coopword.sqlite");
  seedLiveDatabase(databasePath).close();

  for (const label of ["../escape", "a/b", "a\\b", "..", ""]) {
    await assert.rejects(
      () =>
        backupDatabase({
          dataDir: dir,
          databaseUrl: sqliteUrl(databasePath),
          label,
          now: new Date("2026-05-01T10:00:00.000Z"),
        }),
      /path-safe|label/i,
    );
  }

  assert.equal(existsSync(join(dir, "backups")), false);
});

test("safe labels are included in the backup file name", async () => {
  const dir = dataDirectory();
  const databasePath = join(dir, "coopword.sqlite");
  seedLiveDatabase(databasePath).close();

  const result = await backupDatabase({
    dataDir: dir,
    databaseUrl: sqliteUrl(databasePath),
    label: "sha256-abc123",
    now: new Date("2026-05-01T10:00:00.000Z"),
  });
  assert.match(result.path, /coopword-2026-05-01T10-00-00Z-sha256-abc123\.sqlite$/);
  assert.equal(result.quickCheck, "ok");
});

test("a repeated timestamp does not overwrite the prior known-good backup", async () => {
  const dir = dataDirectory();
  const databasePath = join(dir, "coopword.sqlite");
  seedLiveDatabase(databasePath).close();

  const options = {
    dataDir: dir,
    databaseUrl: sqliteUrl(databasePath),
    now: new Date("2026-05-01T10:00:00.000Z"),
  };
  const prior = await backupDatabase(options);
  const priorDigest = digest(prior.path);

  await assert.rejects(() => backupDatabase(options), /already exists|exists/i);
  assert.equal(digest(prior.path), priorDigest);
});

test("retention removes owned backups older than 30 days and keeps the cutoff and unrelated files", async () => {
  const dir = dataDirectory();
  const databasePath = join(dir, "coopword.sqlite");
  seedLiveDatabase(databasePath).close();

  const now = new Date("2026-06-15T12:00:00.000Z");
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const older = new Date(cutoff.getTime() - 1000);
  const backupsDir = join(dir, "backups");
  mkdirSync(backupsDir, { recursive: true });

  const olderName = "coopword-2026-05-16T11-59-59Z.sqlite";
  const cutoffName = "coopword-2026-05-16T12-00-00Z.sqlite";
  const unrelated = "operator-notes.txt";
  const olderWal = `${olderName}-wal`;
  const olderShm = `${olderName}-shm`;
  const cutoffWal = `${cutoffName}-wal`;
  writeFileSync(join(backupsDir, olderName), "old");
  writeFileSync(join(backupsDir, cutoffName), "cutoff");
  writeFileSync(join(backupsDir, olderWal), "old wal");
  writeFileSync(join(backupsDir, olderShm), "old shm");
  writeFileSync(join(backupsDir, cutoffWal), "cutoff wal");
  writeFileSync(join(backupsDir, unrelated), "keep");

  assert.equal(older.toISOString(), "2026-05-16T11:59:59.000Z");
  assert.equal(cutoff.toISOString(), "2026-05-16T12:00:00.000Z");

  const result = await backupDatabase({
    dataDir: dir,
    databaseUrl: sqliteUrl(databasePath),
    now,
  });

  const names = readdirSync(backupsDir).sort();
  assert.equal(names.includes(olderWal), false);
  assert.equal(names.includes(olderShm), false);
  assert.equal(names.includes(cutoffWal), true);
  assert.equal(names.includes(olderName), false);
  assert.equal(names.includes(cutoffName), true);
  assert.equal(names.includes(unrelated), true);
  assert.equal(names.includes("coopword-2026-06-15T12-00-00Z.sqlite"), true);
  assert.equal(result.quickCheck, "ok");
});

test("backup rejects in-memory and unsupported database urls before writing backups", async () => {
  const dir = dataDirectory();
  await assert.rejects(
    () => backupDatabase({ dataDir: dir, databaseUrl: "sqlite::memory:" }),
    /memory|file-backed|supported/i,
  );
  await assert.rejects(
    () => backupDatabase({ dataDir: dir, databaseUrl: "postgres://localhost/db" }),
    /scheme|supported/i,
  );
  assert.equal(existsSync(join(dir, "backups")), false);
  assert.deepEqual(readdirSync(dir), []);
});

test("default database path backs up beside dataDir/coopword.sqlite", async () => {
  const dir = dataDirectory();
  seedLiveDatabase(join(dir, "coopword.sqlite")).close();

  const result = await backupDatabase({
    dataDir: dir,
    now: new Date("2026-05-01T10:00:00.000Z"),
  });
  assert.equal(result.path, join(dir, "backups", "coopword-2026-05-01T10-00-00Z.sqlite"));
});
