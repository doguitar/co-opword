# Site map

Player-facing pages only. A partial (`cell.html`, `clue.html`, and the other fragments) is not a page. A route that only redirects is listed under the page it lands on.

A signed-out request to any page except Sign in, Revise, and Help is sent to Sign in.

## Sign in

`GET /` with no Player cookie. The Player enters an email and posts to `/sign-in`. The magic link is not a page. It is `/magic?token=...` in `data/magic-link-outbox.jsonl`. That link opens Home, or the Session when the token carries an Invite.

Reached from: a direct visit, any other page when the Player is signed out, or the menu Sign out action. That action posts `/sign-out`, which redirects to `/` after the Player cookie is cleared.

Goes to: Home or a Session, after the magic link.

## Home

`GET /` for a signed-in Player. Greets a Player who has a display name with "Welcome back, " and that name, shows the control to set a name when the Player has none, and the live Sessions that Player is in. Each Session links to `/session?invite=...`. When there are none, Home links to Published and says to start one from a published crossword. Posting `/display-name` returns here.

Reached from: the magic link when it has no Invite, Library, Completions, and Close on a Session.

Goes to: an open Session, or Published when there is none.

## Library

`GET /library`. Lists the Crosswords shipped with the product. Each title links to `/crossword?title=...`.

Reached from: Home.

Goes to: Crossword, Home.

## Crossword

`GET /crossword?title=...`. Shows that Library Crossword's title, Grid, and clues. Start a Session posts `/session` with the title.

Reached from: Library.

Goes to: Session, Library.

## Build

`GET /build`. The signed-in Player sets a title, an Author, Freestyle or Standard, and a size from 9 to 21. Each Square is one letter or `#` for a block. Update grid lists a clue field for every Word of two or more Squares. An optional address emails the Revise link and is not stored. Publish posts that Crossword through the same rules as Publish. A success shows the Revise link. `GET /build?token=...` opens Revise. A rejected Crossword stays on Build with the error.

Reached from: the menu, or Revise.

Goes to: Revise, from a successful Publish or a successful revision.

## Publish

`GET /publish`. The signed-in Player submits an Author and Crossword JSON, and may type an address to email the Revise link. That address is not stored. A successful post stays on a confirmation that links to Revise and names the address only when one was typed. A rejected Crossword stays on an error with no link.

Reached from: Home.

Goes to: Revise, from the confirmation only.

## Revise

`GET /revise?token=...`. The holder sees the builder filled with the current version and may save a new version or delete it. The Published list shows only the newest version. A Session already started stays on its version. Delete takes the newest version off the public list so no new Session can be started from it. An optional email at creation is written to `data/withdraw-outbox.jsonl` and is not stored on the Crossword. `GET /withdraw?token=...` opens this page.

Reached from: the Publish confirmation, Build after a revision, or the outbox.

Goes to: Build, or a message after Delete.

## Published

`GET /published`. Lists published Crosswords. Each item starts a Session with that title and Author.

Reached from: Home.

Goes to: Session. This page has no link back.

## Session

`GET /session?invite=...`. The live Session: Invite code, join link, Grid, clues, Type, Select, Clear, Close, email Invite, Offer friendship, and Decline. Those posts return here, except Close and a letter that makes the Grid match.

Reached from: Crossword, Published, Join, and the magic link when the token carries an Invite.

Goes to: this Session (Type, Select, Clear, Invite, Offer, Decline), Home (Close), Match (the Grid matched), Completions, and Join (the invite link).

## Join

`GET /join?invite=...`. Adds the signed-in Player to that Session and opens it. An invalid Invite is a not-found message.

Reached from: the join link on a Session.

Goes to: Session.

## Match

`GET /match`. Says the Grid matched. Shown only to a Player who has a display name.

Reached from: Type on a Session, when that letter makes the Grid match.

Goes to: Completions.

## Completions

`GET /completions`. Lists finished Sessions for this Player: title, Author, duration, and the roster of letters each Player entered.

Reached from: Session, Match.

Goes to: Home.

## Help

`GET /help`. A read-only guide. A signed-out visitor and a signed-in Player see the same page. It reads and writes nothing.

Reached from: the menu, including Sign in.

Goes to: nowhere on its own.
