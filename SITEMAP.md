# Site map

Player-facing pages only. A partial (`cell.html`, `clue.html`, and the other fragments) is not a page. A route that only redirects is listed under the page it lands on.

A signed-out request to any page except Sign in and Withdraw is sent to Sign in.

## Sign in

`GET /` with no Player cookie. The Player enters an email and posts to `/sign-in`. The magic link is not a page. It is `/magic?token=...` in `data/magic-link-outbox.jsonl`. That link opens Home, or the Session when the token carries an Invite.

Reached from: a direct visit, or any other page when the Player is signed out.

Goes to: Home or a Session, after the magic link.

## Home

`GET /` for a signed-in Player. Shows the display name, the control to set or change it, and other Players. Posting `/display-name` returns here.

Reached from: the magic link when it has no Invite, Library, Completions, and Close on a Session.

Goes to: Library, Publish, Published.

## Library

`GET /library`. Lists the Crosswords shipped with the product. Each title links to `/crossword?title=...`.

Reached from: Home.

Goes to: Crossword, Home.

## Crossword

`GET /crossword?title=...`. Shows that Library Crossword's title, Grid, and clues. Start a Session posts `/session` with the title.

Reached from: Library.

Goes to: Session, Library.

## Publish

`GET /publish`. The signed-in Player submits an Author and Crossword JSON. A successful post stays on a confirmation that names the email and links to Withdraw. A rejected Crossword stays on an error with no link.

Reached from: Home.

Goes to: Withdraw, from the confirmation only.

## Withdraw

`GET /withdraw?token=...`. Takes that published Crossword off the public list, or says the link cannot. The same link is written to `data/withdraw-outbox.jsonl`.

Reached from: the Publish confirmation, or the withdraw outbox.

Goes to: nowhere. The result is a message with no link.

## Published

`GET /published`. Lists published Crosswords. Each item links to `/published-crossword?title=...&author=...`.

Reached from: Home.

Goes to: Published Crossword. This page has no link back.

## Published Crossword

`GET /published-crossword?title=...&author=...`. Shows the title, the Author (a blank Author reads "no Author"), and the Word count. Start a Session posts `/session` with the title and Author. An unpublished pair is a not-found message.

Reached from: Published.

Goes to: Session. This page has no link back.

## Session

`GET /session?invite=...`. The live Session: Invite code, join link, Grid, clues, Type, Select, Clear, Close, email Invite, Offer friendship, and Decline. Those posts return here, except Close and a letter that makes the Grid match.

Reached from: Crossword, Published Crossword, Join, and the magic link when the token carries an Invite.

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
