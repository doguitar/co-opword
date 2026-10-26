import assert from "node:assert/strict";
import { test } from "node:test";
import { CrosswordRejected, DisplayNameTaken, openCoOpword, type CoOpword } from "./coopword.ts";

test("a magic link to a new email creates a Player and signs them in, and a later link to that email signs the same Player in", () => {
  const coOpword = openCoOpword();

  const firstLink = coOpword.requestMagicLink("Ada@Example.com");
  assert.equal(firstLink.email, "ada@example.com");
  const firstSession = coOpword.openMagicLink(firstLink.token);

  assert.deepEqual(coOpword.whoAmI(firstSession), { displayName: null });

  coOpword.chooseDisplayName(firstSession, "Ada");

  const returnLink = coOpword.requestMagicLink("ada@example.com");
  const returnSession = coOpword.openMagicLink(returnLink.token);

  assert.deepEqual(coOpword.whoAmI(returnSession), { displayName: "Ada" });
  assert.deepEqual(coOpword.whoAmI(firstSession), { displayName: "Ada" });
});

test("a display name already taken, ignoring capitals, is rejected", () => {
  const coOpword = openCoOpword();
  const sam = coOpword.openMagicLink(coOpword.requestMagicLink("sam@example.com").token);
  coOpword.chooseDisplayName(sam, "Sam");

  const other = coOpword.openMagicLink(coOpword.requestMagicLink("other@example.com").token);

  assert.throws(() => coOpword.chooseDisplayName(other, "sam"), DisplayNameTaken);
  assert.deepEqual(coOpword.whoAmI(other), { displayName: null });
  assert.deepEqual(coOpword.playersOthersSee(other), [{ displayName: "Sam" }]);
});

test("renaming frees the old name, and other Players see the new display name rather than the email", () => {
  const coOpword = openCoOpword();
  const sam = coOpword.openMagicLink(coOpword.requestMagicLink("sam@example.com").token);
  coOpword.chooseDisplayName(sam, "Sam");

  const other = coOpword.openMagicLink(coOpword.requestMagicLink("other@example.com").token);

  coOpword.chooseDisplayName(sam, "Samuel");

  assert.deepEqual(coOpword.playersOthersSee(other), [{ displayName: "Samuel" }]);
  assert.deepEqual(coOpword.whoAmI(other), { displayName: null });

  coOpword.chooseDisplayName(other, "Sam");
  assert.deepEqual(coOpword.whoAmI(other), { displayName: "Sam" });
  assert.deepEqual(coOpword.playersOthersSee(sam), [{ displayName: "Sam" }]);
});

test("closing the browser and opening it again returns the same Player", () => {
  const coOpword = openCoOpword();
  const session = coOpword.openMagicLink(coOpword.requestMagicLink("ada@example.com").token);
  coOpword.chooseDisplayName(session, "Ada");

  const reopened = openCoOpword(coOpword.snapshot());

  assert.deepEqual(reopened.whoAmI(session), { displayName: "Ada" });

  const again = reopened.openMagicLink(reopened.requestMagicLink("ada@example.com").token);
  assert.deepEqual(reopened.whoAmI(again), { displayName: "Ada" });
});

function signedIn(coOpword: CoOpword, email: string, displayName: string) {
  const session = coOpword.openMagicLink(coOpword.requestMagicLink(email).token);
  coOpword.chooseDisplayName(session, displayName);
  return session;
}

test("a signed-in Player opens a library Crossword and sees its title, letters, Words, and clues, and no Author", () => {
  const coOpword = openCoOpword();
  const session = signedIn(coOpword, "ada@example.com", "Ada");

  coOpword.admitLibraryCrossword({
    title: "Tiny",
    kind: "freestyle",
    size: 9,
    squares: Array.from({ length: 81 }, (_, index) => (Math.floor(index / 9) === 0 ? "A" : "#")),
    words: [{ direction: "across", row: 0, column: 0, answer: "AAAAAAAAA", clue: "Nine As" }],
  });

  assert.deepEqual(
    coOpword.library(session).map((crossword) => crossword.title),
    ["Tiny"],
  );

  const opened = coOpword.openLibraryCrossword(session, "Tiny");
  assert.equal(opened.title, "Tiny");
  assert.equal(opened.kind, "freestyle");
  assert.equal(opened.size, 9);
  assert.equal(opened.squares[0], "A");
  assert.equal(opened.squares[9], "#");
  assert.deepEqual(opened.words, [
    { direction: "across", row: 0, column: 0, length: 9, clue: "Nine As" },
  ]);
  assert.equal("author" in opened, false);
});

function letters(size: number, letter = "A"): string[] {
  return Array.from({ length: size * size }, () => letter);
}

function bothWays(size: number) {
  const words = [];
  for (let index = 0; index < size; index++) {
    const answer = "A".repeat(size);
    words.push({ direction: "across" as const, row: index, column: 0, answer, clue: `Across ${index}` });
    words.push({ direction: "down" as const, row: 0, column: index, answer, clue: `Down ${index}` });
  }
  return words;
}

test("a Standard library Crossword is 15 by 15 or 21 by 21, symmetric, and every letter sits in both an Across Word and a Down Word", () => {
  const coOpword = openCoOpword();
  const session = signedIn(coOpword, "ada@example.com", "Ada");

  coOpword.admitLibraryCrossword({
    title: "Block",
    kind: "standard",
    size: 15,
    squares: letters(15),
    words: bothWays(15),
  });
  assert.equal(coOpword.openLibraryCrossword(session, "Block").kind, "standard");

  const acrossOnly = bothWays(15).filter((word) => word.direction === "across");
  assert.throws(
    () =>
      coOpword.admitLibraryCrossword({
        title: "Unchecked",
        kind: "standard",
        size: 15,
        squares: letters(15),
        words: acrossOnly,
      }),
    CrosswordRejected,
  );

  const asymmetric = letters(15);
  asymmetric[0] = "#";
  const lopsidedWords = [
    { direction: "across" as const, row: 0, column: 1, answer: "A".repeat(14), clue: "Top" },
    { direction: "down" as const, row: 1, column: 0, answer: "A".repeat(14), clue: "Left" },
  ];
  for (let index = 1; index < 15; index++) {
    lopsidedWords.push({ direction: "across", row: index, column: 0, answer: "A".repeat(15), clue: `Across ${index}` });
    lopsidedWords.push({ direction: "down", row: 0, column: index, answer: "A".repeat(15), clue: `Down ${index}` });
  }
  assert.throws(
    () =>
      coOpword.admitLibraryCrossword({
        title: "Lopsided",
        kind: "standard",
        size: 15,
        squares: asymmetric,
        words: lopsidedWords,
      }),
    CrosswordRejected,
  );

  assert.throws(
    () =>
      coOpword.admitLibraryCrossword({
        title: "Small",
        kind: "standard",
        size: 9,
        squares: letters(9),
        words: bothWays(9),
      }),
    CrosswordRejected,
  );
  assert.deepEqual(
    coOpword.library(session).map((crossword) => crossword.title),
    ["Block"],
  );
});

test("Freestyle allows 9 through 21, including 15, without the half-turn rule, and a letter may sit in only one Word", () => {
  const coOpword = openCoOpword();
  const session = signedIn(coOpword, "ada@example.com", "Ada");
  const squares = letters(15);
  squares[0] = "#";
  const words = [];
  for (let row = 0; row < 15; row++) {
    const start = row === 0 ? 1 : 0;
    words.push({
      direction: "across" as const,
      row,
      column: start,
      answer: "A".repeat(15 - start),
      clue: `Row ${row}`,
    });
  }

  coOpword.admitLibraryCrossword({ title: "Loose", kind: "freestyle", size: 15, squares, words });
  assert.equal(coOpword.openLibraryCrossword(session, "Loose").size, 15);

  assert.throws(
    () =>
      coOpword.admitLibraryCrossword({
        title: "Too small",
        kind: "freestyle",
        size: 8,
        squares: letters(8),
        words: [{ direction: "across", row: 0, column: 0, answer: "A".repeat(8), clue: "No" }],
      }),
    CrosswordRejected,
  );
});

test("a white Square in no Word, or a Word shorter than two Squares, is not a library Crossword", () => {
  const coOpword = openCoOpword();
  signedIn(coOpword, "ada@example.com", "Ada");
  const squares = Array.from({ length: 81 }, () => "#");
  squares[0] = "A";
  squares[1] = "A";
  squares[2] = "B";

  assert.throws(
    () =>
      coOpword.admitLibraryCrossword({
        title: "Stray",
        kind: "freestyle",
        size: 9,
        squares,
        words: [{ direction: "across", row: 0, column: 0, answer: "AA", clue: "Pair" }],
      }),
    CrosswordRejected,
  );
  assert.throws(
    () =>
      coOpword.admitLibraryCrossword({
        title: "One",
        kind: "freestyle",
        size: 9,
        squares: Array.from({ length: 81 }, (_, index) => (index === 0 ? "A" : "#")),
        words: [{ direction: "across", row: 0, column: 0, answer: "A", clue: "Single" }],
      }),
    CrosswordRejected,
  );
  assert.deepEqual(coOpword.library(signedIn(coOpword, "bea@example.com", "Bea")), []);
});

test("no two library Crosswords share a title, and the library is still there after the browser closes", () => {
  const coOpword = openCoOpword();
  const session = signedIn(coOpword, "ada@example.com", "Ada");
  const crossword = {
    title: "Tiny",
    kind: "freestyle" as const,
    size: 9,
    squares: Array.from({ length: 81 }, (_, index) => (Math.floor(index / 9) === 0 ? "A" : "#")),
    words: [{ direction: "across" as const, row: 0, column: 0, answer: "AAAAAAAAA", clue: "Nine As" }],
  };
  coOpword.admitLibraryCrossword(crossword);
  assert.throws(() => coOpword.admitLibraryCrossword(crossword), CrosswordRejected);

  const reopened = openCoOpword(coOpword.snapshot());
  assert.equal(reopened.openLibraryCrossword(session, "Tiny").words[0].clue, "Nine As");
});

const tinyCrossword = {
  title: "Tiny",
  kind: "freestyle" as const,
  size: 9,
  squares: Array.from({ length: 81 }, (_, index) => (Math.floor(index / 9) === 0 ? "A" : "#")),
  words: [{ direction: "across" as const, row: 0, column: 0, answer: "AAAAAAAAA", clue: "Nine As" }],
};

test("a Player publishes a finished Crossword, and the Withdraw link only takes it off the public list", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "Ada@Example.com", "Ada");
  coOpword.admitLibraryCrossword(tinyCrossword);

  const issued = coOpword.publishCrossword(ada, tinyCrossword, "");
  assert.equal(issued.email, "ada@example.com");
  assert.deepEqual(coOpword.published(ada), [{ title: "Tiny", author: "" }]);

  const opened = coOpword.openPublishedCrossword(ada, "Tiny", "");
  assert.equal(opened.author, "");
  assert.equal(opened.words[0].clue, "Nine As");
  assert.equal("withdrawToken" in opened, false);
  assert.equal(coOpword.openLibraryCrossword(ada, "Tiny").title, "Tiny");

  const kept = openCoOpword(coOpword.snapshot());
  assert.deepEqual(kept.published(ada), [{ title: "Tiny", author: "" }]);

  kept.withdrawCrossword(issued.withdrawToken);
  assert.deepEqual(kept.published(ada), []);
  assert.equal(kept.openLibraryCrossword(ada, "Tiny").title, "Tiny");
  assert.throws(() => kept.withdrawCrossword(issued.withdrawToken), CrosswordRejected);
});

test("the Author is whatever was published, a blank Author counts, and a later rename does not change it", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "ada@example.com", "Ada");

  coOpword.publishCrossword(ada, tinyCrossword, "Ada");
  coOpword.chooseDisplayName(ada, "Beatrice");
  assert.equal(coOpword.openPublishedCrossword(ada, "Tiny", "Ada").author, "Ada");

  assert.throws(() => coOpword.publishCrossword(ada, tinyCrossword, "Ada"), CrosswordRejected);
  coOpword.publishCrossword(ada, { ...tinyCrossword, title: "Other" }, "");
  coOpword.publishCrossword(ada, tinyCrossword, "");
  assert.deepEqual(coOpword.published(ada), [
    { title: "Tiny", author: "Ada" },
    { title: "Other", author: "" },
    { title: "Tiny", author: "" },
  ]);

  const stray = {
    ...tinyCrossword,
    title: "Stray",
    squares: Array.from({ length: 81 }, (_, index) => (index < 3 ? "A" : "#")),
    words: [{ direction: "across" as const, row: 0, column: 0, answer: "AA", clue: "Pair" }],
  };
  assert.throws(() => coOpword.publishCrossword(ada, stray, "Ada"), CrosswordRejected);
  assert.equal(coOpword.published(ada).some((crossword) => crossword.title === "Stray"), false);
});

test("two Players fill one Session from a library Crossword, and the first letter Locks the Square", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  const sam = signedIn(coOpword, "sam@example.com", "Sam");
  coOpword.admitLibraryCrossword(tinyCrossword);

  const first = coOpword.startSession(ada, "Tiny");
  const second = coOpword.startSession(ada, "Tiny");
  assert.notEqual(first.invite, second.invite);

  const joined = coOpword.joinSession(sam, first.invite);
  assert.equal(joined.invite, first.invite);
  assert.throws(() => coOpword.openLibraryCrossword({ token: first.invite }, "Tiny"));

  const before = coOpword.openSession(sam, first.invite);
  assert.equal(before.squares[0].letter, null);
  assert.equal(before.squares[0].letter === "A", false);
  assert.deepEqual(before.players.map((player) => player.displayName), ["Ada", "Sam"]);
  assert.deepEqual(before.players.map((player) => player.letters), [0, 0]);
  assert.equal(before.words[0].clue, "Nine As");

  coOpword.selectSquare(ada, first.invite, 0);
  coOpword.selectSquare(ada, first.invite, 1);
  coOpword.selectSquare(sam, first.invite, 1);
  const present = coOpword.openSession(ada, first.invite);
  assert.deepEqual(present.squares[0].present, []);
  assert.deepEqual(present.squares[1].present.sort(), ["Ada", "Sam"]);

  coOpword.typeLetter(ada, first.invite, "b");
  assert.deepEqual(
    coOpword.openSession(ada, first.invite).players.map((player) => player.letters),
    [1, 0],
  );
  assert.throws(() => coOpword.typeLetter(sam, first.invite, "C"), CrosswordRejected);
  assert.equal(coOpword.openSession(sam, first.invite).squares[1].letter, "B");

  coOpword.clearSquare(sam, first.invite, 1);
  coOpword.typeLetter(sam, first.invite, "C");

  const kept = openCoOpword(coOpword.snapshot());
  const restored = kept.openSession(ada, first.invite);
  assert.equal(restored.squares[1].letter, "C");
  assert.deepEqual(restored.players.map((player) => player.letters), [0, 1]);
  assert.equal(restored.squares[1].locked, true);
  assert.deepEqual(restored.players.map((player) => player.displayName).sort(), ["Ada", "Sam"]);
  assert.equal(kept.openLibraryCrossword(ada, "Tiny").squares[1], "A");
});

test("a Player can be in two Sessions, and a letter lands only on the Square selected in that Session", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  const sam = signedIn(coOpword, "sam@example.com", "Sam");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const first = coOpword.startSession(ada, "Tiny");
  const second = coOpword.startSession(ada, "Tiny");
  coOpword.joinSession(sam, first.invite);
  coOpword.openSession(sam, first.invite);

  coOpword.typeLetter(ada, first.invite, "B");
  assert.equal(coOpword.openSession(sam, first.invite).squares[0].letter, null);

  coOpword.selectSquare(ada, first.invite, 0);
  coOpword.selectSquare(ada, second.invite, 2);
  coOpword.typeLetter(ada, first.invite, "B");
  assert.equal(coOpword.openSession(sam, first.invite).squares[0].letter, "B");
  assert.equal(coOpword.openSession(ada, second.invite).squares[2].letter, null);
  assert.deepEqual(coOpword.openSession(ada, second.invite).squares[0].present, []);

  coOpword.closeSession(ada, first.invite);
  const stillThere = coOpword.openSession(sam, first.invite);
  assert.deepEqual(stillThere.squares[0].present, []);
  assert.deepEqual(stillThere.players.map((player) => player.displayName).sort(), ["Ada", "Sam"]);
  const kept = openCoOpword(coOpword.snapshot());
  assert.equal(kept.openSession(ada, first.invite).squares[0].letter, "B");
});

const WEEK = 7 * 24 * 60 * 60 * 1000;

function fillSolved(coOpword: CoOpword, player: { token: string }, invite: string) {
  for (let index = 0; index < 9; index++) {
    coOpword.selectSquare(player, invite, index);
    coOpword.typeLetter(player, invite, "A");
  }
}

test("the Session ends only when the Grid matches, and only Players who left a Locked letter get that Completion", () => {
  const coOpword = openCoOpword();
  coOpword.noteTime(0);
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  const sam = signedIn(coOpword, "sam@example.com", "Sam");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const invite = coOpword.startSession(ada, "Tiny").invite;
  coOpword.joinSession(sam, invite);
  coOpword.openSession(sam, invite);

  for (let index = 0; index < 8; index++) {
    coOpword.selectSquare(ada, invite, index);
    coOpword.typeLetter(ada, invite, "A");
  }
  coOpword.selectSquare(ada, invite, 8);
  coOpword.typeLetter(ada, invite, "B");
  assert.equal(coOpword.openSession(ada, invite).squares[8].letter, "B");
  assert.equal(coOpword.completions(ada).length, 0);
  assert.equal(coOpword.openSession(ada, invite).squares.some((square) => square.letter === "A" && square.block), false);

  coOpword.clearSquare(ada, invite, 8);
  coOpword.noteTime(5000);
  coOpword.selectSquare(ada, invite, 8);
  coOpword.typeLetter(ada, invite, "A");

  assert.throws(() => coOpword.openSession(ada, invite));
  const completion = coOpword.completions(ada)[0];
  assert.equal(completion.title, "Tiny");
  assert.equal(completion.author, null);
  assert.equal(completion.duration, 5000);
  assert.deepEqual(completion.roster, [{ displayName: "Ada", letters: 9 }]);
  assert.equal(coOpword.completions(sam).length, 0);

  coOpword.chooseDisplayName(ada, "Beatrice");
  assert.equal(coOpword.completions(ada)[0].roster[0].displayName, "Ada");

  const again = coOpword.startSession(ada, "Tiny").invite;
  coOpword.noteTime(8000);
  fillSolved(coOpword, ada, again);
  assert.equal(coOpword.completions(ada).length, 2);
  assert.equal(coOpword.completions(ada)[1].duration, 3000);
});

test("a Player leaves seven days after their last letter or Square selection, and an idle Session keeps nothing", () => {
  const coOpword = openCoOpword();
  coOpword.noteTime(0);
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  const sam = signedIn(coOpword, "sam@example.com", "Sam");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const invite = coOpword.startSession(ada, "Tiny").invite;
  coOpword.joinSession(sam, invite);
  coOpword.openSession(sam, invite);
  coOpword.selectSquare(ada, invite, 0);
  coOpword.typeLetter(ada, invite, "B");

  coOpword.noteTime(6 * 24 * 60 * 60 * 1000);
  coOpword.selectSquare(ada, invite, 0);
  coOpword.selectSquare(sam, invite, 1);
  coOpword.noteTime(WEEK);
  assert.throws(() => coOpword.openSession(ada, invite));
  assert.equal(coOpword.openSession(sam, invite).squares[0].letter, "B");
  assert.equal(coOpword.openSession(sam, invite).players.some((player) => player.displayName === "Ada"), false);

  coOpword.joinSession(ada, invite);
  coOpword.noteTime(WEEK + 6 * 24 * 60 * 60 * 1000 - 1);
  coOpword.selectSquare(sam, invite, 2);
  coOpword.noteTime(WEEK + 6 * 24 * 60 * 60 * 1000);
  assert.equal(coOpword.openSession(ada, invite).players.some((player) => player.displayName === "Ada"), true);

  const idle = openCoOpword();
  idle.noteTime(0);
  const solo = signedIn(idle, "solo@example.com", "Solo");
  idle.admitLibraryCrossword(tinyCrossword);
  const abandoned = idle.startSession(solo, "Tiny").invite;
  idle.selectSquare(solo, abandoned, 0);
  idle.typeLetter(solo, abandoned, "B");
  idle.noteTime(WEEK);
  assert.throws(() => idle.openSession(solo, abandoned));
  assert.equal(idle.completions(solo).length, 0);
});

test("friendship is offered inside one Session, and a decline is visible only to the offerer", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  const sam = signedIn(coOpword, "sam@example.com", "Sam");
  const pat = signedIn(coOpword, "pat@example.com", "Pat");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const invite = coOpword.startSession(ada, "Tiny").invite;
  coOpword.joinSession(sam, invite);
  coOpword.joinSession(pat, invite);
  assert.throws(() => coOpword.offerFriendship(ada, invite, "Nobody"));

  coOpword.offerFriendship(ada, invite, "Sam");
  assert.throws(() => coOpword.offerFriendship(ada, invite, "Sam"));
  assert.deepEqual(coOpword.sessionAlerts(sam, invite), [{ displayName: "Ada", kind: "pending" }]);
  assert.deepEqual(coOpword.friends(ada), []);

  coOpword.declineFriendship(sam, invite, "Ada");
  assert.deepEqual(coOpword.sessionAlerts(ada, invite), [{ displayName: "Sam", kind: "declined" }]);
  assert.deepEqual(coOpword.sessionAlerts(sam, invite), []);
  assert.deepEqual(coOpword.sessionAlerts(pat, invite), []);
  assert.throws(() => coOpword.offerFriendship(ada, invite, "Sam"));
  assert.throws(() => coOpword.offerFriendship(sam, invite, "Ada"));

  const other = coOpword.startSession(ada, "Tiny").invite;
  coOpword.joinSession(sam, other);
  coOpword.offerFriendship(sam, other, "Ada");
  coOpword.offerFriendship(ada, other, "Sam");
  assert.deepEqual(coOpword.friends(ada), [{ displayName: "Sam", email: "sam@example.com" }]);
  assert.deepEqual(coOpword.sessionAlerts(ada, invite), [{ displayName: "Sam", kind: "declined" }]);

  const kept = openCoOpword();
  kept.noteTime(0);
  const ada2 = signedIn(kept, "ada@example.com", "Ada");
  const sam2 = signedIn(kept, "sam@example.com", "Sam");
  kept.admitLibraryCrossword(tinyCrossword);
  const fresh = kept.startSession(ada2, "Tiny").invite;
  kept.joinSession(sam2, fresh);
  kept.openSession(ada2, fresh);
  kept.offerFriendship(ada2, fresh, "Sam");
  kept.declineFriendship(sam2, fresh, "Ada");
  kept.noteTime(6 * 24 * 60 * 60 * 1000);
  kept.selectSquare(ada2, fresh, 0);
  kept.noteTime(WEEK);
  assert.throws(() => kept.openSession(sam2, fresh));
  kept.joinSession(sam2, fresh);
  assert.deepEqual(kept.sessionAlerts(ada2, fresh), [{ displayName: "Sam", kind: "declined" }]);
  assert.throws(() => kept.offerFriendship(ada2, fresh, "Sam"));

  const pending = kept.startSession(ada2, "Tiny").invite;
  kept.joinSession(sam2, pending);
  kept.offerFriendship(ada2, pending, "Sam");
  kept.noteTime(WEEK + 6 * 24 * 60 * 60 * 1000);
  kept.selectSquare(ada2, pending, 1);
  kept.noteTime(WEEK + WEEK);
  kept.joinSession(sam2, pending);
  assert.deepEqual(kept.sessionAlerts(sam2, pending), []);
  kept.offerFriendship(ada2, pending, "Sam");
  assert.deepEqual(kept.sessionAlerts(sam2, pending), [{ displayName: "Ada", kind: "pending" }]);
});

test("typing an email invites that address into the Session and does not make a Friend", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  const sam = signedIn(coOpword, "sam@example.com", "Sam");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const invite = coOpword.startSession(ada, "Tiny").invite;

  const existing = coOpword.inviteEmail(ada, invite, "Sam@Example.com");
  assert.equal(existing.token, null);
  assert.equal(coOpword.openSession(sam, invite).players.some((player) => player.displayName === "Sam"), true);
  assert.deepEqual(coOpword.friends(ada), []);

  const issued = coOpword.inviteEmail(ada, invite, "new@example.com");
  const newbie = coOpword.openMagicLink(issued.token ?? "");
  coOpword.chooseDisplayName(newbie, "New");
  assert.equal(coOpword.openSession(newbie, invite).title, "Tiny");
  assert.deepEqual(coOpword.friends(ada), []);
  assert.deepEqual(coOpword.friends(newbie), []);
});

test("opening an email invite magic link signs the new Player into that Session Grid before they choose a display name", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const invite = coOpword.startSession(ada, "Tiny").invite;

  const issued = coOpword.inviteEmail(ada, invite, "new@example.com");
  const newbie = coOpword.openMagicLink(issued.token ?? "");
  assert.equal(newbie.invite, invite);
  assert.deepEqual(coOpword.whoAmI(newbie), { displayName: null });

  assert.ok(newbie.invite);
  const grid = coOpword.openSession(newbie, newbie.invite);
  assert.equal(grid.title, "Tiny");
  assert.equal(grid.invite, invite);
  assert.equal(grid.squares[0].letter, null);
  assert.equal(grid.squares[0].block, false);
  assert.equal(grid.squares[9].block, true);
  assert.deepEqual(coOpword.friends(ada), []);
  assert.deepEqual(coOpword.friends(newbie), []);

  coOpword.chooseDisplayName(newbie, "New");
  assert.deepEqual(coOpword.whoAmI(newbie), { displayName: "New" });

  const kept = openCoOpword(coOpword.snapshot());
  const restored = kept.openSession(newbie, invite);
  assert.equal(restored.title, "Tiny");
  assert.equal(restored.squares[0].letter, null);
  assert.equal(restored.squares[9].block, true);
});

test("a plain sign-in magic link identifies no Invite, and an ended Session still signs the new Player in", () => {
  const coOpword = openCoOpword();
  coOpword.noteTime(0);
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const invite = coOpword.startSession(ada, "Tiny").invite;

  const plain = coOpword.openMagicLink(coOpword.requestMagicLink("plain@example.com").token);
  assert.equal(plain.invite, null);
  assert.throws(() => coOpword.openSession(plain, invite));

  const issued = coOpword.inviteEmail(ada, invite, "late@example.com");
  coOpword.noteTime(WEEK);
  const late = coOpword.openMagicLink(issued.token ?? "");
  assert.equal(late.invite, null);
  assert.deepEqual(coOpword.whoAmI(late), { displayName: null });
  assert.throws(() => coOpword.openSession(late, invite));
});

test("opening the same magic link a second time does not sign anyone in", () => {
  const coOpword = openCoOpword();
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  coOpword.admitLibraryCrossword(tinyCrossword);
  const invite = coOpword.startSession(ada, "Tiny").invite;
  const token = coOpword.inviteEmail(ada, invite, "new@example.com").token ?? "";
  const newbie = coOpword.openMagicLink(token);
  assert.throws(() => coOpword.openMagicLink(token));
  assert.deepEqual(coOpword.whoAmI(newbie), { displayName: null });
  assert.equal(coOpword.openSession(newbie, invite).title, "Tiny");
});

test("withdrawing a published Crossword leaves the Session and the Completion alone", () => {
  const coOpword = openCoOpword();
  coOpword.noteTime(0);
  const ada = signedIn(coOpword, "ada@example.com", "Ada");
  const issued = coOpword.publishCrossword(ada, tinyCrossword, "Ada");
  const invite = coOpword.startPublishedSession(ada, "Tiny", "Ada").invite;
  coOpword.selectSquare(ada, invite, 0);
  coOpword.typeLetter(ada, invite, "B");
  coOpword.withdrawCrossword(issued.withdrawToken);
  assert.equal(coOpword.published(ada).length, 0);
  const opened = coOpword.openSession(ada, invite);
  assert.equal(opened.squares[0].letter, "B");
  assert.equal(opened.squares[0].locked, true);
  assert.equal(opened.words[0].clue, "Nine As");

  coOpword.clearSquare(ada, invite, 0);
  coOpword.noteTime(1000);
  fillSolved(coOpword, ada, invite);
  assert.equal(coOpword.completions(ada)[0].author, "Ada");

  const again = coOpword.publishCrossword(ada, tinyCrossword, "Ada");
  const second = coOpword.startPublishedSession(ada, "Tiny", "Ada").invite;
  fillSolved(coOpword, ada, second);
  coOpword.withdrawCrossword(again.withdrawToken);
  assert.equal(coOpword.completions(ada).every((completion) => completion.title === "Tiny" && completion.author === "Ada"), true);
  assert.equal(coOpword.published(ada).length, 0);
});
