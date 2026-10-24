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
  author: string | null;
  startedAt: number;
  lastActivity: number;
  letters: (string | null)[];
  locked: boolean[];
  writtenBy: (string | null)[];
  presence: { playerId: string; index: number }[];
  memberIds: string[];
  memberClocks: { playerId: string; at: number }[];
  offers: { fromId: string; toId: string; status: "pending" | "declined" }[];
};

type CompletionRecord = {
  title: string;
  author: string | null;
  duration: number;
  roster: { playerId: string; displayName: string | null; letters: number }[];
};

export type Completion = {
  title: string;
  author: string | null;
  duration: number;
  roster: { displayName: string | null; letters: number }[];
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

type OpenView = { playerId: string; invite: string };

type State = {
  players: Player[];
  magicLinks: { token: string; email: string; invite?: string }[];
  sessions: { token: string; playerId: string }[];
  library: OpenedLibraryCrossword[];
  published: PublishedCrossword[];
  liveSessions: LiveSession[];
  openViews: OpenView[];
  completions: CompletionRecord[];
  friends: { a: string; b: string }[];
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
  typeLetter(session: PlayerSession, invite: string, letter: string): void;
  clearSquare(session: PlayerSession, invite: string, index: number): void;
  closeSession(session: PlayerSession, invite: string): void;
  noteTime(now: number): void;
  startPublishedSession(session: PlayerSession, title: string, author: string): { invite: string };
  completions(session: PlayerSession): Completion[];
  offerFriendship(session: PlayerSession, invite: string, displayName: string): void;
  declineFriendship(session: PlayerSession, invite: string, displayName: string): void;
  sessionAlerts(session: PlayerSession, invite: string): { displayName: string | null; kind: "pending" | "declined" }[];
  friends(session: PlayerSession): { displayName: string | null }[];
  inviteEmail(session: PlayerSession, invite: string, email: string): { email: string; token: string | null };
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
    openViews: parsed.openViews ?? [],
    completions: parsed.completions ?? [],
    friends: parsed.friends ?? [],
  };

  let now = 0;

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
      if (link.invite) {
        const live = state.liveSessions.find((entry) => entry.invite === link.invite);
        if (live && !live.memberIds.includes(player.id)) addMember(live, player.id);
      }
      return { token: session.token };
    },
    noteTime(value: number): void {
      now = value;
      sweep();
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
      return beginSession(player.id, crossword, null);
    },
    startPublishedSession(session: PlayerSession, title: string, author: string): { invite: string } {
      const player = playerFor(session);
      const opened = this.openPublishedCrossword(session, title, author);
      const { author: publishedAuthor, ...crossword } = opened;
      return beginSession(player.id, structuredClone(crossword), publishedAuthor);
    },
    joinSession(session: PlayerSession, invite: string): { invite: string } {
      const player = playerFor(session);
      const live = liveFor(invite);
      if (!live.memberIds.includes(player.id)) addMember(live, player.id);
      return { invite: live.invite };
    },
    openSession(session: PlayerSession, invite: string): OpenedSession {
      const player = playerFor(session);
      const live = liveFor(invite);
      if (!live.memberIds.includes(player.id)) throw new Error("That Invite is not yours");
      if (!state.openViews.some((view) => view.playerId === player.id && view.invite === invite)) {
        state.openViews.push({ playerId: player.id, invite });
      }
      return openedSession(live);
    },
    selectSquare(session: PlayerSession, invite: string, index: number): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      requireOpen(player.id, invite);
      requireWhite(live, index);
      const previous = live.presence.find((entry) => entry.playerId === player.id);
      if (previous?.index === index) return;
      live.presence = live.presence.filter((entry) => entry.playerId !== player.id);
      live.presence.push({ playerId: player.id, index });
      touch(live, player.id);
    },
    typeLetter(session: PlayerSession, invite: string, letter: string): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      if (!isOpen(player.id, invite)) return;
      const selected = live.presence.find((entry) => entry.playerId === player.id);
      if (!selected) return;
      if (!/^[A-Za-z]$/.test(letter)) throw new CrosswordRejected();
      if (live.locked[selected.index]) throw new CrosswordRejected();
      live.letters[selected.index] = letter.toUpperCase();
      live.locked[selected.index] = true;
      live.writtenBy[selected.index] = player.id;
      touch(live, player.id);
      if (gridMatches(live)) finish(live);
    },
    clearSquare(session: PlayerSession, invite: string, index: number): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      requireWhite(live, index);
      live.letters[index] = null;
      live.locked[index] = false;
      live.writtenBy[index] = null;
    },
    completions(session: PlayerSession): Completion[] {
      const player = playerFor(session);
      return state.completions
        .filter((completion) => completion.roster.some((entry) => entry.playerId === player.id))
        .map((completion) => ({
          title: completion.title,
          author: completion.author,
          duration: completion.duration,
          roster: completion.roster.map((entry) => ({ displayName: entry.displayName, letters: entry.letters })),
        }));
    },
    offerFriendship(session: PlayerSession, invite: string, displayName: string): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      const other = memberByName(live, displayName);
      if (other.id === player.id) throw new Error("That Player is not in this Session");
      const between = live.offers.filter((offer) => pair(offer.fromId, offer.toId, player.id, other.id));
      const incoming = between.find((offer) => offer.status === "pending" && offer.toId === player.id);
      if (incoming) {
        live.offers = live.offers.filter((offer) => offer !== incoming);
        rememberFriends(player.id, other.id);
        return;
      }
      if (between.length > 0) throw new Error("That friendship was already offered");
      live.offers.push({ fromId: player.id, toId: other.id, status: "pending" });
    },
    declineFriendship(session: PlayerSession, invite: string, displayName: string): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      const other = memberByName(live, displayName);
      const pending = live.offers.find((offer) => offer.status === "pending" && offer.fromId === other.id && offer.toId === player.id);
      if (!pending) throw new Error("There is no friendship offer");
      pending.status = "declined";
    },
    sessionAlerts(session: PlayerSession, invite: string): { displayName: string | null; kind: "pending" | "declined" }[] {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      const nameOf = (playerId: string) => state.players.find((entry) => entry.id === playerId)?.displayName ?? null;
      return live.offers
        .filter((offer) => (offer.status === "pending" && offer.toId === player.id) || (offer.status === "declined" && offer.fromId === player.id))
        .map((offer) => ({
          displayName: nameOf(offer.status === "pending" ? offer.fromId : offer.toId),
          kind: offer.status,
        }));
    },
    friends(session: PlayerSession): { displayName: string | null }[] {
      const player = playerFor(session);
      return state.friends
        .filter((pairIds) => pairIds.a === player.id || pairIds.b === player.id)
        .map((pairIds) => {
          const otherId = pairIds.a === player.id ? pairIds.b : pairIds.a;
          return { displayName: state.players.find((entry) => entry.id === otherId)?.displayName ?? null };
        });
    },
    inviteEmail(session: PlayerSession, invite: string, email: string): { email: string; token: string | null } {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      const normalized = normalizeEmail(email);
      const existing = state.players.find((entry) => entry.email === normalized);
      if (existing) {
        if (!live.memberIds.includes(existing.id)) addMember(live, existing.id);
        return { email: normalized, token: null };
      }
      const token = crypto.randomUUID();
      state.magicLinks.push({ token, email: normalized, invite });
      return { email: normalized, token };
    },
    closeSession(session: PlayerSession, invite: string): void {
      const player = playerFor(session);
      const live = liveFor(invite);
      requireMember(live, player.id);
      state.openViews = state.openViews.filter((view) => view.playerId !== player.id || view.invite !== invite);
      live.presence = live.presence.filter((entry) => entry.playerId !== player.id);
    },
  };

  function beginSession(playerId: string, crossword: OpenedLibraryCrossword, author: string | null): { invite: string } {
    const invite = crypto.randomUUID();
    state.liveSessions.push({
      invite,
      crossword,
      author,
      startedAt: now,
      lastActivity: now,
      letters: crossword.squares.map(() => null),
      locked: crossword.squares.map(() => false),
      writtenBy: crossword.squares.map(() => null),
      presence: [],
      memberIds: [playerId],
      memberClocks: [{ playerId, at: now }],
      offers: [],
    });
    state.openViews.push({ playerId, invite });
    return { invite };
  }

  function addMember(live: LiveSession, playerId: string): void {
    live.memberIds.push(playerId);
    live.memberClocks.push({ playerId, at: now });
  }

  function touch(live: LiveSession, playerId: string): void {
    live.lastActivity = now;
    const clock = live.memberClocks.find((entry) => entry.playerId === playerId);
    if (clock) clock.at = now;
  }

  function gridMatches(live: LiveSession): boolean {
    return live.crossword.squares.every((square, index) => square === "#" || live.letters[index] === square.toUpperCase());
  }

  function finish(live: LiveSession): void {
    const counts = new Map<string, number>();
    live.writtenBy.forEach((playerId, index) => {
      if (!playerId || !live.locked[index]) return;
      counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
    });
    const roster = [...counts.entries()].map(([playerId, letters]) => ({
      playerId,
      displayName: state.players.find((player) => player.id === playerId)?.displayName ?? null,
      letters,
    }));
    if (roster.length > 0) {
      state.completions.push({
        title: live.crossword.title,
        author: live.author,
        duration: now - live.startedAt,
        roster,
      });
    }
    endSession(live);
  }

  function endSession(live: LiveSession): void {
    state.liveSessions = state.liveSessions.filter((entry) => entry !== live);
    state.openViews = state.openViews.filter((view) => view.invite !== live.invite);
  }

  function removeMember(live: LiveSession, playerId: string): void {
    live.memberIds = live.memberIds.filter((id) => id !== playerId);
    live.memberClocks = live.memberClocks.filter((entry) => entry.playerId !== playerId);
    live.presence = live.presence.filter((entry) => entry.playerId !== playerId);
    state.openViews = state.openViews.filter((view) => view.playerId !== playerId || view.invite !== live.invite);
    live.offers = live.offers.filter((offer) => offer.status === "declined" || (offer.fromId !== playerId && offer.toId !== playerId));
  }

  function sweep(): void {
    for (const live of [...state.liveSessions]) {
      if (now - live.lastActivity >= WEEK) {
        endSession(live);
        continue;
      }
      for (const clock of [...live.memberClocks]) {
        if (now - clock.at >= WEEK) removeMember(live, clock.playerId);
      }
    }
  }

  function memberByName(live: LiveSession, displayName: string): Player {
    const found = live.memberIds
      .map((id) => state.players.find((player) => player.id === id))
      .find((player) => player?.displayName === displayName);
    if (!found) throw new Error("That Player is not in this Session");
    return found;
  }

  function pair(fromId: string, toId: string, left: string, right: string): boolean {
    return (fromId === left && toId === right) || (fromId === right && toId === left);
  }

  function rememberFriends(left: string, right: string): void {
    const [a, b] = left < right ? [left, right] : [right, left];
    if (!state.friends.some((entry) => entry.a === a && entry.b === b)) state.friends.push({ a, b });
  }

  function isOpen(playerId: string, invite: string): boolean {
    return state.openViews.some((view) => view.playerId === playerId && view.invite === invite);
  }

  function requireOpen(playerId: string, invite: string): void {
    if (!isOpen(playerId, invite)) throw new Error("That Session is not open");
  }

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
