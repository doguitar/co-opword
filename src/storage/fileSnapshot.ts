import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readSnapshot(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export function writeSnapshot(path: string, snapshot: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, snapshot);
}
