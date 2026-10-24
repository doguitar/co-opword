import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SnapshotStore = {
  read(): Promise<string | undefined>;
  write(snapshot: string): Promise<void>;
};

const schema = `CREATE TABLE IF NOT EXISTS snapshot_store (
  id INTEGER PRIMARY KEY,
  snapshot TEXT NOT NULL
)`;

export async function openSnapshotStore(databaseUrl: string | undefined, dataDir: string): Promise<SnapshotStore> {
  const url = databaseUrl ?? "";
  if (url === "") return openSqlite(join(dataDir, "coopword.sqlite"));
  const scheme = schemeOf(url);
  if (scheme === "sqlite") return openSqlite(sqliteLocation(url));
  if (scheme === "postgres" || scheme === "postgresql") return openPostgres(url);
  if (scheme === "mysql") return openMysql(url);
  throw new Error("DATABASE_URL scheme is not supported");
}

function schemeOf(url: string): string {
  const index = url.indexOf(":");
  if (index <= 0) throw new Error("DATABASE_URL scheme is not supported");
  return url.slice(0, index).toLowerCase();
}

function sqliteLocation(url: string): string {
  const rest = url.slice("sqlite:".length);
  if (rest === ":memory:" || rest === "//:memory:" || rest === "///:memory:") return ":memory:";
  const path = rest.startsWith("///") ? rest.slice(3) : rest.startsWith("//") ? rest.slice(2) : rest;
  if (path === ":memory:") return path;
  if (path === "") throw new Error("DATABASE_URL scheme is not supported");
  return path;
}

function openSqlite(path: string): SnapshotStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(schema);
  const select = db.prepare("SELECT snapshot FROM snapshot_store WHERE id = 1");
  const upsert = db.prepare(
    `INSERT INTO snapshot_store (id, snapshot) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot`,
  );
  return {
    async read() {
      const row = select.get() as { snapshot: string } | undefined;
      return row?.snapshot;
    },
    async write(snapshot: string) {
      upsert.run(snapshot);
    },
  };
}

async function openPostgres(url: string): Promise<SnapshotStore> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(schema);
  return {
    async read() {
      const result = await client.query("SELECT snapshot FROM snapshot_store WHERE id = 1");
      const row = result.rows[0] as { snapshot: string } | undefined;
      return row?.snapshot;
    },
    async write(snapshot: string) {
      await client.query(
        `INSERT INTO snapshot_store (id, snapshot) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
        [snapshot],
      );
    },
  };
}

async function openMysql(url: string): Promise<SnapshotStore> {
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection(url);
  await connection.query(`CREATE TABLE IF NOT EXISTS snapshot_store (
    id INTEGER PRIMARY KEY,
    snapshot LONGTEXT NOT NULL
  )`);
  return {
    async read() {
      const [rows] = await connection.query("SELECT snapshot FROM snapshot_store WHERE id = 1");
      const row = (rows as { snapshot: string }[])[0];
      return row?.snapshot;
    },
    async write(snapshot: string) {
      await connection.query(
        "INSERT INTO snapshot_store (id, snapshot) VALUES (1, ?) ON DUPLICATE KEY UPDATE snapshot = ?",
        [snapshot, snapshot],
      );
    },
  };
}
