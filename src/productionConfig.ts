import { inspectMailConfiguration } from "./mail/magicLink.ts";
import { isFileBackedSqliteUrl } from "./storage/snapshotStore.ts";

function failConfig(message: string): never {
  console.error(message);
  process.exit(1);
}

export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;

  const databaseUrl = process.env.DATABASE_URL ?? "";
  const missing: string[] = [];
  if (!databaseUrl.trim()) missing.push("DATABASE_URL");
  const mail = inspectMailConfiguration();
  missing.push(...mail.missing);
  if (missing.length > 0) failConfig(`Missing required configuration: ${missing.join(", ")}`);

  const invalid: string[] = [];
  if (!isFileBackedSqliteUrl(databaseUrl)) invalid.push("DATABASE_URL");
  if (mail.invalid.includes("PUBLIC_URL")) invalid.push("PUBLIC_URL");
  if (process.env.PORT !== undefined) {
    const value = Number(process.env.PORT);
    if (!Number.isInteger(value) || value < 1 || value > 65535) invalid.push("PORT");
  }
  if (mail.invalid.includes("SMTP_PORT")) invalid.push("SMTP_PORT");
  if (mail.invalid.includes("SMTP_SECURE")) invalid.push("SMTP_SECURE");
  if (invalid.length > 0) failConfig(`Invalid configuration: ${invalid.join(", ")}`);
}
