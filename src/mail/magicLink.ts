export type MagicLinkMail = {
  email: string;
  openPath: string;
};

export function deliverMagicLink(email: string, token: string): MagicLinkMail {
  return {
    email,
    openPath: `/magic?token=${encodeURIComponent(token)}`,
  };
}
