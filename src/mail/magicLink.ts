import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function deliverLink(outboxPath: string, email: string, token: string): { email: string; token: string } {
  const delivered = { email, token };
  mkdirSync(dirname(outboxPath), { recursive: true });
  appendFileSync(outboxPath, `${JSON.stringify(delivered)}\n`);
  return delivered;
}
