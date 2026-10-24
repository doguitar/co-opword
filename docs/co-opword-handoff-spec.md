## Problem Statement

A Player who wants to fill a crossword with other people has no shared Grid. Paper and single-player apps leave each person on their own copy. There is no way to meet on one live Grid, keep accounts, return to a Session, or keep a record of a finished Grid without keeping the Grid itself.

## Solution

Co-opword is one web product. A Player signs in with an email, picks a unique display name, and fills one Crossword with other Players on one live Grid. Crosswords come from a library and from a public list any Player can publish to. A Session is how they fill that Grid together. When the Grid matches, each Player who left a letter still Locked gets a Completion. The Grid and the Session are not kept.

Players use one product module. The browser, mail, and storage are adapters behind that module. They are not separate places where the rules are decided.

## User Stories

1. As a Player, I want to sign in with my email by a magic link, so that I have an account without a password.
2. As a new Player, I want the magic link to create my account, so that the first sign-in is enough to start.
3. As a Player, I want to choose a display name, so that other Players know who I am.
4. As a Player, I want a taken display name rejected, so that I am not confused with someone else.
5. As a Player, I want display names treated as the same when they differ only by capitals, so that "Sam" and "sam" cannot both exist.
6. As a Player, I want to rename myself, so that I can change what others see.
7. As a Player, I want the old display name freed when I rename, so that someone else can take it.
8. As a Player, I want my new display name to replace the old one in Sessions I am still in, so that others see one current name.
9. As a Player, I want other Players to see only my display name, so that my email stays private.
10. As a Friend, I want to see another Player's display name only, so that a friendship does not reveal an email.
11. As a Player, I want to browse the library, so that I can open a Crossword that was not published by a Player.
12. As a Player, I want each library Crossword to show a title, letters, Words, and clues, so that I know what I would be filling.
13. As a Player, I want a library Crossword to have no Author, so that I do not treat it as someone's published puzzle.
14. As a Player, I want no two library Crosswords to share a title, so that I can tell them apart by title.
15. As a Player, I want a library title to be allowed to match a published title, so that the two lists stay separate.
16. As a Player, I want to browse one public list of published Crosswords, so that I can open puzzles other Players published.
17. As a Player, I want a published Crossword to show its title, letters, Words, clues, and Author, so that I know whose name is on it.
18. As a Player, I want no two published Crosswords to share the same title and Author, so that a blank Author still counts toward that pair.
19. As a Player, I want to publish a Crossword, so that any Player can open it.
20. As a Player, I want the Author to start as my display name, so that I do not have to type it.
21. As a Player, I want to change the Author to any other name, or clear it, before I publish, so that the name on the Crossword is not forced to be my display name.
22. As a Player, I want publishing to drop any tie to my account, so that the Crossword does not remember me.
23. As a Player, I want letters, clues, title, and Author to stay fixed after publish, so that a live Session is not rewritten under me.
24. As a Player, I want an email with a Withdraw link when I publish, so that I can take the Crossword off the public list later.
25. As a person with a Withdraw link, I want to take that Crossword off the public list, so that new Players stop opening it from the list.
26. As a person with a Withdraw link, I want that link to do nothing else, so that I cannot edit the Crossword or touch Sessions and Completions.
27. As a Player in a Session started from a withdrawn Crossword, I want that Session unchanged, so that we keep the Crossword we started with.
28. As a Player with a Completion of a withdrawn Crossword, I want that Completion unchanged, so that the record still shows the title and Author from when the Grid matched.
29. As a Player, I want a Standard Crossword only on a 15×15 or 21×21 grid, so that the usual size is fixed.
30. As a Player, I want a Standard Crossword's black Squares to match under a half-turn, so that the grid is symmetric.
31. As a Player, I want every letter in a Standard Crossword to sit in both an Across Word and a Down Word, so that there are no unchecked letters.
32. As a Player, I want a Freestyle Crossword on any square grid from 9×9 through 21×21, so that a puzzle can be smaller or looser than Standard.
33. As a Player, I want Freestyle to allow a 15×15 or 21×21 grid without the Standard rules, so that size alone does not make it Standard.
34. As a Player, I want Freestyle chosen at creation, so that a Crossword does not switch kind later.
35. As a Player, I want every Word to be an Across or Down run of at least two white Squares with one clue, so that a Crossword is solvable from clues.
36. As a Player, I want a white Square in no Word to keep a Crossword unfinished, so that stray squares cannot be published or treated as done.
37. As a Player, I want to start a Session from any Crossword I can open, so that I do not need permission from an Author.
38. As a Player, I want each start to be its own Session, even on the same Crossword, so that two groups do not share one Grid.
39. As a Player, I want to be in more than one Session at once, so that I can move between Grids.
40. As a Player, I want an Invite shown as a link and as a code, so that I can share whichever is easier.
41. As a Player, I want the link and the code to be the same Invite, so that either one joins the same Session.
42. As a Player, I want an Invite to join one Session and not to open a Crossword by itself, so that the puzzle and the live Grid stay distinct.
43. As a person with an Invite, I want to join even if I am not a Friend, so that friendship is not a gate.
44. As a Player in a live Session, I want to type an email to invite that address, so that someone not yet in the Session can land in it.
45. As a new Player invited by email from a Session, I want a sign-up magic link that lands me in that Session, so that I do not assemble an account and then hunt for the Grid.
46. As an existing Player invited by email from a Session, I want to land in that Session, so that the email is a Session invite.
47. As a Player, I want an email invite not to create a Friend, so that joining a Grid is not a friendship.
48. As a Player, I want to open one of my Sessions in a browser, so that I can fill the Grid.
49. As a Player, I want the same rules on a phone and on a larger screen, so that the device does not change the Session.
50. As a Player, I want no separate app, so that the browser is the only client.
51. As a Player with a Session open, I want to see the Grid, its clues, Presence, and the letters typed, so that I can fill it with the others.
52. As a Player, I want no join lines, leave lines, lock notices, reactions, or other messages, so that the live view stays the Grid.
53. As a Player, I want to select one Square in the Session I have open, so that the others see my Presence there.
54. As a Player, I want a later selection in that Session to replace my Presence, so that I have one Square selected there.
55. As a Player in several Sessions, I want each open Session to have its own Presence, so that my Square in one Grid is not my Square in another.
56. As a Player, I want a Session I am in but do not have open to show no Presence, so that others do not see a cursor I am not using.
57. As a Player, I want a dropped connection to count as that Session not being open, so that my Presence disappears without my leaving the Session.
58. As a Player, I want Presence to return only after I open that Session and select a Square again, so that a reconnect does not invent a selection.
59. As a Player, I want no Presence when I have no Square selected, so that an idle open Session is not a cursor.
60. As a Player, I want a letter to go only to the Session I type it into, so that one keystroke cannot fill another Grid.
61. As a Player, I want a letter with no selected Square to do nothing, so that typing does not guess a Square.
62. As a Player, I want the first letter on an empty Square to Lock it, so that the Grid keeps that letter.
63. As a Player, I want a second letter on a Locked Square to be rejected, so that I cannot overwrite someone without a clear.
64. As a Player in the Session, I want to clear a Lock, so that any of us can undo a letter.
65. As a Player, I want a cleared Square to take a new first letter, so that we can try again.
66. As a Player, I want my letters to stay Locked if I am no longer in the Session, so that leaving does not wipe the Grid.
67. As a Player, I want no way to check a letter or a Word before the Grid matches, so that we solve it without an answer key.
68. As a Player, I want a wrong letter to stay Locked until someone clears it, so that the only correctness signal is the Session ending when the Grid matches.
69. As a Player, I want nothing to reveal a letter I did not type, so that the Crossword's answers stay hidden.
70. As a Player, I want no hint on a Square or a Word, so that the clue, the Word length, Locked letters, and Presence are all I can learn.
71. As a Player, I want the Session to end when every Square is filled and every Word matches the Crossword, so that we are done together.
72. As a Player, I want a filled Grid that still has a wrong Word to keep the Session going, so that a full Grid is not the same as a match.
73. As a Player who wrote at least one letter still Locked at the match, I want a Completion, so that I have a record that I was on that Grid.
74. As a Player who wrote nothing still Locked at the end, I want no Completion, so that watching is not the same as filling.
75. As a Player on the roster, I want the Completion to show the Crossword title, so that I know which puzzle it was.
76. As a Player on the roster, I want the Author as it was when the Grid matched, so that a library Crossword shows no Author and a published one keeps the name from the end.
77. As a Player on the roster, I want one duration from Session start until the Grid matched, so that I can see how long that Session took.
78. As a Player on the roster, I want each roster Player's display name as it was then, with the count of letters they wrote that were still Locked, so that the record is who put what on the Grid.
79. As a Player on the roster, I want every roster Player to see that same Completion, so that we share one record.
80. As a Player, I want a later display-name change not to change a Completion, so that the roster stays what it was at the match.
81. As a Player, I want the filled Grid not kept on the Completion, so that the record is not a replay.
82. As a Player, I want the Session itself not kept after it ends in a match, so that the Completion is what remains.
83. As a Player, I want each Session to leave its own Completion, so that two Sessions on the same Crossword do not merge.
84. As a Player, I want joining a Session to start a seven-day clock, so that an untouched membership does not last forever.
85. As a Player, I want my last letter or Square selection in that Session to reset my seven days, so that playing keeps me in it.
86. As a Player, I want holding the same Square, or merely leaving the Session open, not to reset my seven days, so that idle presence is not play.
87. As a Player, I want to leave that Session seven days after my last letter or Square selection there, so that I do not have a manual leave.
88. As a Player, I want the same Invite to join that Session again after I have left, so that I can come back while it still exists.
89. As a Player who rejoins, I want my seven days to start over, so that the new join is a fresh clock.
90. As a Player, I want any Player's letter or Square selection to reset the Session's seven-day clock, so that a quiet Grid can still end.
91. As a Player, I want the Session to end with nothing kept when nobody writes a letter or selects a Square for seven days, so that an abandoned Grid does not leave a Completion.
92. As a Player in a Session, I want to offer friendship to another Player already in it, so that we can become Friends.
93. As a Player, I want a Friend offer to a person not in the Session to be impossible, so that friendship stays inside the Grid we share.
94. As a Player who receives a Friend offer, I want it as a pending alert, so that I can accept or decline.
95. As a Player, I want both of us to be Friends only after the offer is accepted, so that one side cannot force it.
96. As a Player who offered, I want an offer the other way to accept the pending offer, so that we do not need two separate accepts.
97. As a Player, I want to decline a Friend offer, so that I can refuse.
98. As a Player who offered, I want to see that the other Player declined, until that Session ends, so that I know not to expect a Friend from this Grid.
99. As a Player who declined, I want the offerer to be the only one who sees the decline, so that I am not marked for everyone.
100. As a Player, I want neither of us to offer again in that Session after a decline, so that the refusal sticks.
101. As a Player, I want the same Friend invite not to be resent while it is already pending or after it was declined in that Session, so that one offer is enough.
102. As a Player, I want a decline to last until the Session ends, including if I leave and rejoin, so that rejoining does not reopen the offer.
103. As a Player, I want a pending Friend offer to end if either of us leaves that Session, so that an unanswered offer does not outlive our membership.
104. As a Player, I want a Friend decision in one Session not to change another Session, so that each Grid has its own offers.
105. As a Player, I want to sign in again later and still have my account, Sessions I have not left, and Completions, so that the product remembers me.
106. As a Player, I want a Session's Grid, Locks, and roster clocks to still be there after I close the browser, so that the live Grid is not only on my device.

## Implementation Decisions

- One product module owns the rules. Its interface is what a Player can do and what that Player can then see: sign-in, display name, the library, the published list, publish, withdraw, start and join a Session, select a Square, type or clear a letter, Friend offer, accept, and decline, and read Completions. Tests call that interface.
- The browser is an adapter. It opens a Session on a phone or a larger screen with the same rules. It is not a second place where behavior is specified.
- Mail is an adapter. The module decides when a sign-in magic link or a Withdraw link is issued, and to which email. The adapter delivers it. A Session email invite is a join, not a Friend offer.
- Storage is an adapter. It round-trips the module's state so an account, a live Session, and a Completion survive a closed browser. It does not invent rules.
- Time is an input to the module. The seven-day Player clock and the seven-day Session clock are defined by letters, Square selections, and joins, not by how long a page stays open.
- A display name is unique ignoring capitals. A rename frees the previous name and updates the name shown in Sessions that Player is still in. A Completion keeps the display names from the moment the Grid matched.
- A Crossword is either library or published. Both have a title, letters, Words, and clues. Standard is 15×15 or 21×21, black Squares match under a half-turn, and every letter sits in both an Across Word and a Down Word. Freestyle is a square from 9×9 through 21×21, chosen at creation, with no half-turn rule, and a letter may sit in only one Word. A Word is an Across or Down run of at least two white Squares with one clue. A white Square in no Word is not a finished Crossword.
- Library titles are unique. A library Crossword has no Author. Published title and Author are unique as a pair, and a blank Author counts. A library title may match a published title. The Author starts as the publisher's display name and may be any string or blank before publish. After publish there is no link to that Player, and letters, clues, title, and Author do not change.
- The Withdraw link is emailed at publish. Whoever has it may only remove that Crossword from the public list. Sessions already started and Completions already written keep the Crossword they had.
- Any Player may start a Session from a Crossword they can open. Each start is its own Session. One Player may be in several. An Invite is one join token, shown as a link and as a code. It joins that Session and does not open a Crossword. Anyone with it may join, Friend or not.
- Typing an email from a live Session invites that address into that Session. A new address gets a sign-up magic link and lands in the Session. An existing Player lands in the Session. Neither creates a Friend.
- A letter is written only in the Session the Player types it into, on that Session's selected Square. No selected Square means the letter does nothing. The first letter Locks the Square. Another letter is rejected until any Player in the Session clears it.
- Presence is the one selected Square in one open Session, shown to the others. It is absent when that Session is not open, when no Square is selected, or when the Player has left. A dropped connection is that Session not open. Presence returns only after the Player opens it and selects a Square again. A later selection in that Session replaces it. Each open Session has its own Presence.
- The live Session shows the Grid, its clues, Presence, and typed letters. It shows no messages, join or leave lines, lock notices, or reactions.
- There is no check and no hint. Nothing tells a Player that a letter or a Word is correct before the Grid matches, and nothing reveals a letter they did not type. A wrong letter stays Locked until a Player clears it. The Session ends in a match only when every Square is filled and every Word matches the Crossword.
- A Completion keeps the title and Author as they were when the Grid matched, the duration from start until the match, and the roster. The roster is each Player who wrote at least one letter still Locked at the end, under the display name they had then, with the count of those letters. Every roster Player sees the same Completion. The filled Grid is not kept. The Session is not kept. Each Session leaves its own Completion.
- A Player leaves one Session seven days after their last letter or Square selection there. Joining starts that clock. Holding the same Square, or leaving the Session open, does not. Locks stay. The same Invite rejoins, and that Player's seven days start over. Any letter or Square selection by anyone also resets the Session clock. If nobody does either for seven days, the Session ends and nothing is kept.
- A Friend offer is only to another Player already in that Session, and it stays a pending alert until accepted. Both must accept; an offer the other way accepts the first. A decline is visible to the offerer until the Session ends, and invisible to the other Player. Neither may offer again in that Session. The same invite cannot be resent. A decline lasts until the Session ends, including leave and rejoin. A pending offer ends if either Player leaves that Session. Other Sessions are unaffected. Two Players are Friends only after both have accepted.

## Testing Decisions

- A good test calls the product module's interface and asserts what a Player can see or do next. It does not assert how the module stores data, how mail is sent, or how the browser is built.
- The only tested module is that product module. Browser, mail, and storage adapters are not behavioral seams. A test may use a stand-in for mail or the clock so it can observe an issued link or move seven days without waiting.
- The repo has no product tests yet, so there is no prior art to copy. New tests should read as the user stories: sign in, publish, start, type, clear, offer, match, and abandon.
- Persistence is specified as round-tripping the module state. Do not add a second suite that re-proves the rules through the database.

## Out of Scope

- A native mobile client. The handoff is the browser only.
- Chat, system lines, lock notices, and reactions.
- A check of a letter or a Word before the Grid matches, and any hint.
- Editing a published Crossword, or withdrawing it by being the Player who published it rather than by holding the Withdraw link.
- A manual leave control. Leaving is the seven-day clock.
- Keeping the filled Grid, replaying a Session, or keeping an abandoned Session.
- Password sign-in, or showing an email to other Players.

## Further Notes

- The decisions collected on [Chart the Co-opword handoff spec](https://github.com/doguitar/co-opword/issues/1) are the source for this spec. Domain words match `CONTEXT.md`. Where a rename "everywhere, including past Sessions" meets a frozen Completion roster, the Completion wins: ended Sessions are not kept, and the roster stays as it was when the Grid matched.
- The confirmed test seam is the one product module above. Do not split the rules across a UI seam and a domain seam.

