# Co-opword

A live crossword that several people fill on one shared grid.

## Language

**Crossword**:
A titled puzzle of crossing words on one grid, solved from clues. Every white Square holds one letter and sits in a Word. It is either in the library or published by a Player. Every published Crossword is on one list any Player can open; the library is a separate list. No two library Crosswords share a title. No two published Crosswords share the same title and Author; a blank Author counts. A library title may match a published title. Publishing sets an Author and does not keep a link to that Player. Letters, clues, title, and Author do not change after publish. Any Player may publish one.
_Avoid_: Puzzle, word search

**Withdraw link**:
The link emailed to the publishing Player when a Crossword is published. Whoever has it may take that Crossword off the public list, and that is all it can do. The Crossword does not remember the Player. A Session already started from it is unchanged. A Completion is unchanged.
_Avoid_: Edit link, unpublish

**Standard**:
A Crossword on a 15×15 or 21×21 grid whose black Squares match under a half-turn, and whose every letter sits in both an Across Word and a Down Word.
_Avoid_: American, cryptic

**Freestyle**:
A square Crossword from 9×9 through 21×21 with no half-turn rule. A letter may sit in only one Word. Chosen at creation, including a 15×15 or 21×21 grid.
_Avoid_: Freeform, casual

**Word**:
An Across or Down run of at least two white Squares. Each Word has one clue. A white Square in no Word is not a finished Crossword.
_Avoid_: Entry, answer

**Author**:
The name on a published Crossword. It starts as that Player's display name and may be changed to any other name, or cleared, before publish. It has no further tie to display names. A library Crossword has no Author.
_Avoid_: Byline, credit

**Friend**:
Two Players who have both accepted the connection. During a Session one Player may offer it to another in that Session — the other may decline, and an offer the other way accepts the first — and someone who is not a Friend can still join with an Invite. A pending offer ends if either Player leaves that Session. A decline lasts until the Session ends, including if that Player leaves and rejoins.
_Avoid_: Contact, follower

**Grid**:
The shared crossword being filled.
_Avoid_: Board, sheet

**Player**:
A person with an account who can join a Session. The account is their email. Other Players see only a display name, which is unique.
_Avoid_: User

**Invite**:
The means of joining one Session. It is shown as a link or a code; those are the same Invite. It does not open a Crossword.
_Avoid_: Room code, URL

**Square**:
One cell of the Grid.
_Avoid_: Cell, tile

**Lock**:
The state of a Square after the first letter is written. Another letter is rejected until any Player in the Session clears it.
_Avoid_: Freeze, claim

**Presence**:
The one Square a Player has selected in one open Session, shown to the others. It is absent when that Session is not open, no Square is selected, or the Player has left that Session. A later selection in that Session replaces it.
_Avoid_: Cursor, caret

**Session**:
The live period when Players fill one Grid at the same time. Any Player may start one from a Crossword they can open. Each start is its own Session, even on the same Crossword, and a Player may be in more than one at once, each with its own Presence. A letter is written only in the Session they type it into, on that Session's selected Square; with no selected Square it does nothing. Players do not send messages. The live Session shows no join or leave lines, lock notices, or reactions — only the Grid, its clues, Presence, and the letters typed. A Player cannot learn whether a letter or a Word is correct until the Grid matches. Nothing reveals a letter they did not type. There is no hint. A Player leaves one Session seven days after their last letter or Square selection there. Joining starts that clock. Holding the same Square, or leaving the Session open, does not. Their letters stay Locked. The same Invite joins that Session again, and the seven days start over. Any such letter or selection also resets the Session. If nobody does either for seven days, the Session ends and nothing is kept. It also ends when every Square is filled and every Word matches the Crossword, and then it leaves a Completion. The Session itself is not kept. A Player opens it in a browser, on a phone or a larger screen, with the same rules either way. There is no separate app.
_Avoid_: Game, match, room, app, native

**Completion**:
What remains after a Session ends. It keeps the Crossword title and Author as they were when the Grid matched (a library Crossword has no Author), the duration from Session start until the Grid matched, and the roster. The roster is each Player who wrote at least one letter still Locked at the end, under the display name they had then, with the count of those letters. Every Player on the roster sees that same Completion. A later display-name change does not change it. The filled Grid is not kept. Each Session leaves its own Completion.
_Avoid_: Score, replay, save
