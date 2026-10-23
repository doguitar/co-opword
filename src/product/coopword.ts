export type MagicLink = { token: string; email: string };

export type PlayerSession = { token: string };

export type SignedInPlayer = { displayName: string | null };

export class DisplayNameTaken extends Error {
  constructor() {
    super("That display name is already taken");
    this.name = "DisplayNameTaken";
  }
}

type Player = {
  id: string;
  email: string;
  displayName: string | null;
};

type State = {
  players: Player[];
  magicLinks: { token: string; email: string }[];
  sessions: { token: string; playerId: string }[];
};

export type CoOpword = {
  requestMagicLink(email: string): MagicLink;
  openMagicLink(token: string): PlayerSession;
  chooseDisplayName(session: PlayerSession, displayName: string): void;
  whoAmI(session: PlayerSession): SignedInPlayer;
  playersOthersSee(session: PlayerSession): { displayName: string }[];
  snapshot(): string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nameKey(displayName: string): string {
  return displayName.toLowerCase();
}

export function openCoOpword(snapshot?: string): CoOpword {
  const state: State = snapshot
    ? (JSON.parse(snapshot) as State)
    : { players: [], magicLinks: [], sessions: [] };

  function playerFor(session: PlayerSession): Player {
    const found = state.sessions.find((entry) => entry.token === session.token);
    if (!found) {
      throw new Error("That sign-in is no longer valid");
    }
    const player = state.players.find((entry) => entry.id === found.playerId);
    if (!player) {
      throw new Error("That sign-in is no longer valid");
    }
    return player;
  }

  return {
    requestMagicLink(email: string): MagicLink {
      const normalized = normalizeEmail(email);
      const token = crypto.randomUUID();
      state.magicLinks.push({ token, email: normalized });
      return { token, email: normalized };
    },
    openMagicLink(token: string): PlayerSession {
      const linkIndex = state.magicLinks.findIndex((link) => link.token === token);
      if (linkIndex === -1) {
        throw new Error("That magic link is no longer valid");
      }
      const [link] = state.magicLinks.splice(linkIndex, 1);
      let player = state.players.find((entry) => entry.email === link.email);
      if (!player) {
        player = { id: crypto.randomUUID(), email: link.email, displayName: null };
        state.players.push(player);
      }
      const session = { token: crypto.randomUUID(), playerId: player.id };
      state.sessions.push(session);
      return { token: session.token };
    },

    chooseDisplayName(session: PlayerSession, displayName: string): void {
      const player = playerFor(session);
      const key = nameKey(displayName);
      const taken = state.players.some(
        (other) => other.id !== player.id && other.displayName !== null && nameKey(other.displayName) === key,
      );
      if (taken) {
        throw new DisplayNameTaken();
      }
      player.displayName = displayName;
    },

    whoAmI(session: PlayerSession): SignedInPlayer {
      const player = playerFor(session);
      return { displayName: player.displayName };
    },

    playersOthersSee(session: PlayerSession): { displayName: string }[] {
      const player = playerFor(session);
      return state.players
        .filter((other) => other.id !== player.id && other.displayName !== null)
        .map((other) => ({ displayName: other.displayName as string }));
    },

    snapshot(): string {
      return JSON.stringify(state);
    },
  };
}
