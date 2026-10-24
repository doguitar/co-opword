# Regression

Two passes. Both are required before a change that a Player can see is committed. The first is the existing test script. The second is a browser pass that writes one screenshot per page into this repo for a person to look at.

## Automated

From the repo root:

```
npm test
npm run typecheck
```

`npm test` runs the product, browser, and snapshot-store tests named in `package.json`. Both commands must finish with no failures. A product test is not a substitute for the browser pass below.

## Browser screenshots

The PNGs in `regression/` are the baseline captured through the omp browser relay.

Any change to a UI element requires a new screenshot of every page that shows that element. Replace the file for that page. Do not add a date or a suffix. Commit the new PNG with the change. A UI change without the new screenshot is not done.

### Capture

Start a server that does not write the product snapshot into `data/`. The magic-link outbox is still appended under `data/`; do not commit that file.

```
cmd /c "set PORT=3477&& set DATABASE_URL=sqlite::memory:&& npm start"
```

From the agent eval kernel, open the omp relay against that server. This uses the user's Chrome through the relay and leaves their other tabs alone:

```python
tab = await browser.open(
    name="coopword",
    url="http://127.0.0.1:3477/",
    app={"relay": True},
    persist=True,
)
```

A full-page shot is a PNG path. Copy it onto the name in the table:

```python
shot = await tab.screenshot(fullPage=True, format="png")
shutil.copyfile(shot, "regression/sign-in.png")
```

`tab.waitFor(300)` is not a delay. The number is read as a selector. Use `asyncio.sleep` between submits.

Sign in before any other shot. Fill the email, submit, and open the last `/magic?token=...` line in `data/magic-link-outbox.jsonl`. Set the display name to Relay. That Home page is `home.png`.

Then, in order:

1. Library, then Crossword `First Row`. Save `crossword.png` before starting the Session.
2. Start the Session and save `session.png` while the top row is still empty.
3. Match the Grid. Select sets the Square from the index field. Type writes the letter onto that selected Square, not onto the index. For squares 0 through 8, Select, then Type `A`. The last Type opens `/match`.
4. Completions, then Publish. Publish the same nine-A Freestyle Crossword as title Tiny and Author Ada. Open Published, then that Published Crossword.
5. About, then Support.

Close the relay tab with `browser.close(name="coopword")`. The memory server holds no snapshot file.

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
| About | `/about` | `regression/about.png` |
| Support | `/support` | `regression/support.png` |

Fragments (`cell.html`, `clue.html`, `row.html`, and the other partials) are not pages. They show up inside the screenshots above.

A new HTML page that the server returns on its own gets a new row and a new PNG in the same folder, named for that page. A person reviews the committed images against the pages just captured. The pass fails if a listed file is missing, or if a visible page has no row.
