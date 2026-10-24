import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSnapshotStore } from "./snapshotStore.ts";

function dataDirectory(): string {
  return mkdtempSync(join(tmpdir(), "coopword-"));
}

function sqliteFileIn(dir: string): string | undefined {
  return readdirSync(dir).find((name) => readFileSync(join(dir, name)).subarray(0, 15).toString() === "SQLite format 3");
}

test("an unset or empty database url stores one snapshot string in the local data directory", async () => {
  for (const databaseUrl of [undefined, ""]) {
    const dir = dataDirectory();
    const store = await openSnapshotStore(databaseUrl, dir);
    assert.equal(await store.read(), undefined);
    await store.write("alpha");
    assert.equal(await store.read(), "alpha");
    await store.write("beta");
    assert.equal(await store.read(), "beta");
    assert.ok(sqliteFileIn(dir));
  }
});

test("an in-memory sqlite database stores a snapshot and creates no file", async () => {
  const dir = dataDirectory();
  const store = await openSnapshotStore("sqlite::memory:", dir);
  assert.equal(await store.read(), undefined);
  await store.write("kept");
  assert.equal(await store.read(), "kept");
  await store.write("replaced");
  assert.equal(await store.read(), "replaced");
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(existsSync("sqlite::memory:"), false);
  assert.equal(existsSync(":memory:"), false);
});

test("an unknown database scheme fails before a read or a write and creates no sqlite file", async () => {
  const dir = dataDirectory();
  await assert.rejects(openSnapshotStore("redis://localhost/1", dir));
  assert.deepEqual(readdirSync(dir), []);
});
