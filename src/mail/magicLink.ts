export type MagicLinkMessage = {
  email: string;
  link: string;
};

export type Mailbox = {
  sendMagicLink(email: string, link: string): void;
  messagesFor(email: string): MagicLinkMessage[];
};

export function createMailbox(): Mailbox {
  const messages: MagicLinkMessage[] = [];
  return {
    sendMagicLink(email: string, link: string): void {
      messages.push({ email, link });
    },
    messagesFor(email: string): MagicLinkMessage[] {
      return messages.filter((message) => message.email === email);
    },
  };
}
