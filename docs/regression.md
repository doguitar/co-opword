# Regression

Two passes. Both are required before a change that a Player can see is committed. The first is the existing test script. The second is a browser pass that writes one screenshot per page into this repo for a person to look at.

## Automated

From the repo root:

```
npm test
npm run typecheck
```

`npm test` runs `src/product/coopword.test.ts` and `src/browser/server.test.ts`. Both commands must finish with no failures. A product test is not a substitute for the browser pass below.

## Browser screenshots

Start a clean server so the shots are not mixed with a previous snapshot:

```
npm start
```

The server listens on `http://localhost:3000` unless `PORT` is set. Sign in with a new email. The magic link is appended to `data/magic-link-outbox.jsonl` as `/magic?token=...`. Open that path in the same browser, set a display name, then open each page below.

Save a full-page PNG under `regression/`, using the name in the table. Replace the previous file for that page. Do not add a date or a suffix. Commit the PNGs with the change that altered the page.

| Page | Path | File |
| --- | --- | --- |
| Sign in | `/` with no Player cookie | `regression/sign-in.png` |
| Home | `/` after a display name is set | `regression/home.png` |
| Library | `/library` | `regression/library.png` |
| Crossword | `/crossword?title=` for one Library Crossword | `regression/crossword.png` |
| Publish | `/publish` | `regression/publish.png` |
| Published | `/published` | `regression/published.png` |
| Published Crossword | `/published-crossword` for one published title and Author | `regression/published-crossword.png` |
| Session | `/session?invite=` for a live Session | `regression/session.png` |
| Match | `/match` after the Grid has matched | `regression/match.png` |
| Completions | `/completions` | `regression/completions.png` |

Fragments (`cell.html`, `clue.html`, `row.html`, and the other partials) are not pages. They show up inside the screenshots above.

A new HTML page that the server returns on its own gets a new row and a new PNG in the same folder, named for that page. A person reviews the committed images against the pages just captured. The pass fails if a listed file is missing, or if a visible page has no row.
