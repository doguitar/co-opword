import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DeliveredMagicLink = {
  email: string;
  token: string;
};

export function deliverMagicLink(outboxPath: string, email: string, token: string): DeliveredMagicLink {
  const delivered = { email, token };
  mkdirSync(dirname(outboxPath), { recursive: true });
  appendFileSync(outboxPath, `${JSON.stringify(delivered)}\n`);
  return delivered;
}
