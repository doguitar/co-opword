export type MagicLink = { token: string; email: string };

export type PlayerSession = { token: string };

export type SignedInPlayer = { displayName: string | null };

export class DisplayNameTaken extends Error {
  constructor() {
    super("That display name is already taken");
    this.name = "DisplayNameTaken";
  }
}

export class CrosswordRejected extends Error {
  constructor() {
    super("That Crossword cannot go in the library");
    this.name = "CrosswordRejected";
  }
}

export type Direction = "across" | "down";

export type LibraryCrosswordInput = {
  title: string;
  kind: "standard" | "freestyle";
  size: number;
  squares: string[];
  words: { direction: Direction; row: number; column: number; answer: string; clue: string }[];
};

export type OpenedLibraryCrossword = {
  title: string;
  kind: "standard" | "freestyle";
  size: number;
  squares: string[];
  words: { direction: Direction; row: number; column: number; length: number; clue: string }[];
};

type Player = {
  id: string;
  email: string;
  displayName: string | null;
};

type PublishedCrossword = {
  crossword: OpenedLibraryCrossword;
  author: string;
  withdrawToken: string;
};

type LiveSession = {
  invite: string;
  crossword: OpenedLibraryCrossword;
  letters: (string | null)[];
  locked: boolean[];
  presence: { playerId: string; index: number }[];
  memberIds: string[];
};

type State = {
  players: Player[];
  magicLinks: { token: string; email: string }[];
  sessions: { token: string; playerId: string }[];
  library: OpenedLibraryCrossword[];
  published: PublishedCrossword[];
  liveSessions: LiveSession[];
};

export type OpenedSession = {
  invite: string;
  title: string;
  size: number;
  squares: { letter: string | null; locked: boolean; present: string[]; block: boolean }[];
  words: OpenedLibraryCrossword["words"];
  players: { displayName: string | null }[];
};

export type CoOpword = {
  requestMagicLink(email: string): MagicLink;
  openMagicLink(token: string): PlayerSession;
  chooseDisplayName(session: PlayerSession, displayName: string): void;
  whoAmI(session: PlayerSession): SignedInPlayer;
  playersOthersSee(session: PlayerSession): { displayName: string }[];
  admitLibraryCrossword(crossword: LibraryCrosswordInput): void;
  library(session: PlayerSession): { title: string }[];
  openLibraryCrossword(session: PlayerSession, title: string): OpenedLibraryCrossword;
  publishCrossword(session: PlayerSession, crossword: LibraryCrosswordInput, author: string): { withdrawToken: string; email: string };
  published(session: PlayerSession): { title: string; author: string }[];
  openPublishedCrossword(session: PlayerSession, title: string, author: string): OpenedLibraryCrossword & { author: string };
  withdrawCrossword(token: string): void;
  startSession(session: PlayerSession, title: string): { invite: string };
  joinSession(session: PlayerSession, invite: string): { invite: string };
  openSession(session: PlayerSession, invite: string): OpenedSession;
  selectSquare(session: PlayerSession, invite: string, index: number): void;
  typeLetter(session: PlayerSession, invite: string, index: number, letter: string): void;
  clearSquare(session: PlayerSession, invite: string, index: number): void;
  snapshot(): string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nameKey(displayName: string): string {
  return displayName.toLowerCase();
}

export function openCoOpword(snapshot?: string): CoOpword {
  const parsed: Partial<State> = snapshot ? (JSON.parse(snapshot) as Partial<State>) : {};
  const state: State = {
    players: parsed.players ?? [],
    magicLinks: parsed.magicLinks ?? [],
    sessions: parsed.sessions ?? [],
    library: parsed.library ?? [],
    published: parsed.published ?? [],
    liveSessions: parsed.liveSessions ?? [],
  };

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
    admitLibraryCrossword(crossword: LibraryCrosswordInput): void {
      const admitted = checkedLibraryCrossword(crossword);
      if (state.library.some((existing) => existing.title === admitted.title)) {
        throw new CrosswordRejected();
      }
      state.library.push(admitted);
    },

    library(session: PlayerSession): { title: string }[] {
      playerFor(session);
      return state.library.map((crossword) => ({ title: crossword.title }));
    },

    openLibraryCrossword(session: PlayerSession, title: string): OpenedLibraryCrossword {
      playerFor(session);
      const found = state.library.find((crossword) => crossword.title === title);
      if (!found) {
        throw new Error("That Crossword is not in the library");
      }
      return found;
    },

    publishCrossword(session: PlayerSession, crossword: LibraryCrosswordInput, author: string): { withdrawToken: string; email: string } {
      const player = playerFor(session);
      const admitted = checkedLibraryCrossword(crossword);
      if (state.published.some((item) => item.crossword.title === admitted.title && item.author === author)) {
        throw new CrosswordRejected();
      }
      const withdrawToken = crypto.randomUUID();
      state.published.push({ crossword: admitted, author, withdrawToken });
      return { withdrawToken, email: player.email };
    },

    published(session: PlayerSession): { title: string; author: string }[] {
      playerFor(session);
      return state.published.map((item) => ({ title: item.crossword.title, author: item.author }));
    },

    openPublishedCrossword(session: PlayerSession, title: string, author: string): OpenedLibraryCrossword & { author: string } {
      playerFor(session);
      const found = state.published.find((item) => item.crossword.title === title && item.author === author);
      if (!found) throw new Error("That Crossword is not published");
      return { ...found.crossword, author: found.author };
    },

    withdrawCrossword(token: string): void {
      const index = state.published.findIndex((item) => item.withdrawToken === token);
      if (index === -1) throw new CrosswordRejected();
      state.published.splice(index, 1);
    },
    startSession(session: PlayerSession, title: string): { invite: string } {
      const player = playerFor(session);
      const crossword = structuredClone(this.openLibraryCrossword(session, title));
      const invite = crypto.randomUUID();
      state.liveSessions.push({
        invite,
        crossword,
        letters: crossword.squares.map(() => null),
        locked: crossword.squares.map(() => false),
        presence: [],
        memberIds: [player.id],
      });
      return { invite };
    },
    joinSession(session: PlayerSession, invite: string): { invite: string } {
      const player = playerFor(session);
      const live = liveFor(invite);
      if (!live.memberIds.includes(player.id)) live.memberIds.push(player.id);
      return { invite: live.invite };
    },
    openSession(session: PlayerSession, invite: string): OpenedSession {
      const player = playerFor(session);
      const live = liveFor(invite);
      if (!live.memberIds.includes(player.id)) throw new Error("That Invite is not yours");
      return openedSession(live);
    },
    selectSquare(session: PlayerSession, invite: string, index: number): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      requireWhite(live, index);
      live.presence = live.presence.filter((entry) => entry.playerId !== player.id);
      live.presence.push({ playerId: player.id, index });
    },
    typeLetter(session: PlayerSession, invite: string, index: number, letter: string): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      requireWhite(live, index);
      if (!/^[A-Za-z]$/.test(letter)) throw new CrosswordRejected();
      if (live.locked[index]) throw new CrosswordRejected();
      live.letters[index] = letter.toUpperCase();
      live.locked[index] = true;
    },
    clearSquare(session: PlayerSession, invite: string, index: number): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      requireWhite(live, index);
      live.letters[index] = null;
      live.locked[index] = false;
    },
  };

  function liveFor(invite: string): LiveSession {
    const live = state.liveSessions.find((entry) => entry.invite === invite);
    if (!live) throw new Error("That Invite is no longer valid");
    return live;
  }

  function requireMember(live: LiveSession, playerId: string): void {
    if (!live.memberIds.includes(playerId)) throw new Error("That Invite is not yours");
  }

  function requireWhite(live: LiveSession, index: number): void {
    if (live.crossword.squares[index] === "#" || live.crossword.squares[index] === undefined) throw new CrosswordRejected();
  }

  function openedSession(live: LiveSession): OpenedSession {
    const nameOf = (playerId: string) => state.players.find((player) => player.id === playerId)?.displayName ?? null;
    return {
      invite: live.invite,
      title: live.crossword.title,
      size: live.crossword.size,
      squares: live.crossword.squares.map((square, index) => ({
        letter: square === "#" ? null : live.letters[index],
        locked: live.locked[index],
        present: live.presence.filter((entry) => entry.index === index).map((entry) => nameOf(entry.playerId) ?? ""),
        block: square === "#",
      })),
      words: live.crossword.words,
      players: live.memberIds.map((playerId) => ({ displayName: nameOf(playerId) })),
    };
  }
}

function checkedLibraryCrossword(crossword: LibraryCrosswordInput): OpenedLibraryCrossword {
  const { title, kind, size, squares, words } = crossword;
  if (title.trim() === "") throw new CrosswordRejected();
  if (!Number.isInteger(size)) throw new CrosswordRejected();
  if (kind === "standard") {
    if (size !== 15 && size !== 21) throw new CrosswordRejected();
  } else if (kind === "freestyle") {
    if (size < 9 || size > 21) throw new CrosswordRejected();
  } else {
    throw new CrosswordRejected();
  }
  if (squares.length !== size * size) throw new CrosswordRejected();

  const covered = squares.map(() => ({ across: false, down: false }));
  const storedWords = words.map((word) => {
    if (word.answer.length < 2 || word.clue.trim() === "") throw new CrosswordRejected();
    for (let offset = 0; offset < word.answer.length; offset++) {
      const row = word.row + (word.direction === "down" ? offset : 0);
      const column = word.column + (word.direction === "across" ? offset : 0);
      if (row < 0 || column < 0 || row >= size || column >= size) throw new CrosswordRejected();
      const index = row * size + column;
      if (squares[index] !== word.answer[offset]) throw new CrosswordRejected();
      covered[index][word.direction] = true;
    }
    return {
      direction: word.direction,
      row: word.row,
      column: word.column,
      length: word.answer.length,
      clue: word.clue,
    };
  });

  squares.forEach((square, index) => {
    if (square === "#") return;
    if (!/^[A-Za-z]$/.test(square)) throw new CrosswordRejected();
    const cell = covered[index];
    if (!cell.across && !cell.down) throw new CrosswordRejected();
    if (kind === "standard" && (!cell.across || !cell.down)) throw new CrosswordRejected();
  });

  if (kind === "standard") {
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const black = squares[row * size + column] === "#";
        const opposite = squares[(size - 1 - row) * size + (size - 1 - column)] === "#";
        if (black !== opposite) throw new CrosswordRejected();
      }
    }
  }

  return { title, kind, size, squares: squares.slice(), words: storedWords };
}
