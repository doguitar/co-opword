import { closeSync, mkdirSync, openSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveSqliteDatabasePath } from "./snapshotStore.ts";

const retentionMs = 30 * 24 * 60 * 60 * 1000;
const backupNamePattern =
  /^coopword-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)(?:-[A-Za-z0-9._-]+)?\.sqlite$/;

export type BackupResult = {
  path: string;
  quickCheck: string;
};

function assertSafeBackupLabel(label: string): void {
  if (
    label === "" ||
    label === "." ||
    label === ".." ||
    label.includes("..") ||
    label.includes("/") ||
    label.includes("\\") ||
    label.includes("\0") ||
    !/^[A-Za-z0-9._-]+$/.test(label)
  ) {
    throw new Error("Backup label is not path-safe");
  }
}

function parseBackupArgs(argv: string[]): { label?: string } {
  let label: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--label") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("Backup label is required after --label");
      }
      assertSafeBackupLabel(value);
      label = value;
      continue;
    }
    throw new Error(`Unknown backup argument: ${arg}`);
  }
  return { label };
}

function readQuickCheck(path: string): string {
  // Read-write mode reports CHECK failures that read-only quick_check misses.
  const db = new DatabaseSync(path);
  try {
    const rows = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
    return rows.map((row) => row.quick_check).join("\n");
  } finally {
    db.close();
  }
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function removeBackupFiles(path: string): void {
  unlinkIfPresent(`${path}-wal`);
  unlinkIfPresent(`${path}-shm`);
  unlinkIfPresent(path);
}

function pruneOldBackups(backupsDir: string, now: Date): void {
  const cutoff = now.getTime() - retentionMs;
  for (const name of readdirSync(backupsDir)) {
    const match = backupNamePattern.exec(name);
    if (match === null) continue;
    const iso = match[1]!.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z");
    const time = Date.parse(iso);
    if (Number.isNaN(time) || time >= cutoff) continue;
    removeBackupFiles(join(backupsDir, name));
  }
}

export async function backupDatabase(options: {
  dataDir: string;
  databaseUrl?: string;
  label?: string;
  now?: Date;
}): Promise<BackupResult> {
  if (options.label !== undefined) assertSafeBackupLabel(options.label);

  const databasePath = resolveSqliteDatabasePath(options.databaseUrl, options.dataDir);
  if (databasePath === ":memory:") {
    throw new Error("Backup requires a file-backed SQLite database");
  }

  const now = options.now ?? new Date();
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  const fileName =
    options.label === undefined ? `coopword-${stamp}.sqlite` : `coopword-${stamp}-${options.label}.sqlite`;
  const backupsDir = join(dirname(databasePath), "backups");
  const destination = join(backupsDir, fileName);
  mkdirSync(backupsDir, { recursive: true });

  let ownsDestination = false;
  let keepDestination = false;
  try {
    const descriptor = openSync(destination, "wx", 0o600);
    ownsDestination = true;
    closeSync(descriptor);
    const source = new DatabaseSync(databasePath, { readOnly: true });
    try {
      await backup(source, destination);
    } finally {
      source.close();
    }

    const quickCheck = readQuickCheck(destination);
    if (quickCheck !== "ok") {
      throw new Error(`Backup failed quick_check: ${quickCheck}`);
    }

    keepDestination = true;
    pruneOldBackups(backupsDir, now);
    return { path: destination, quickCheck };
  } finally {
    if (ownsDestination && !keepDestination) {
      try {
        removeBackupFiles(destination);
      } catch {
        // Leave failure reporting to the original error; do not mask it.
      }
    }
  }
}

async function main(argv: string[]): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, "../../data");
  try {
    process.loadEnvFile(join(dataDir, ".env"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const { label } = parseBackupArgs(argv);
  const result = await backupDatabase({
    dataDir,
    databaseUrl: process.env.DATABASE_URL,
    label,
  });
  console.log(`quick_check ${result.quickCheck}`);
  console.log(result.path);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
