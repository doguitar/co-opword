# Regression

Two passes. Both are required before a change that a Player can see is committed. The first is the existing test script. The second is a browser pass that writes one screenshot per page into this repo for a person to look at.

## Automated

From the repo root:

```
npm test
npm run typecheck
```

`npm test` runs the product, browser, and snapshot-store tests named in `package.json`. Both commands must finish with no failures. A product test is not a substitute for the browser pass below.

## Email delivery

Without SMTP credentials outside production, sign-in, session-invite, and Revise links are written to `data/magic-link-outbox.jsonl` and `data/withdraw-outbox.jsonl` for local development. In production, missing SMTP credentials fail delivery instead of writing usable links to disk.

| Variable | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.purelymail.com` (default) |
| `SMTP_PORT` | `465` (default; SSL/TLS) |
| `SMTP_SECURE` | `true` for port 465; set `false` for port 587 with STARTTLS |
| `SMTP_USER` | Your Purelymail login email |
| `SMTP_PASSWORD` | Your Purelymail password or app password |
| `MAIL_FROM` | `donotreply@updo.gg` (default) |
| `PUBLIC_URL` | Public base URL of this deployment, e.g. `https://updo.gg` |

The server also loads `data/.env` on startup when the file exists; inherited environment variables take precedence. For local deployments, put these settings in that ignored file. Keep it private and do not commit it.

Outside production, empty SMTP credentials keep writing usable links to the outbox files above. In production, startup fails fast unless `NODE_ENV=production`, a file-backed SQLite `DATABASE_URL` (in-memory SQLite is rejected), HTTPS `PUBLIC_URL`, `SMTP_USER`, and `SMTP_PASSWORD` are set; SMTP host/port/TLS and `MAIL_FROM` may rely on defaults. Loopback `GET /health` returns only `healthy` or `unhealthy` for process checks.

## Browser screenshots

The PNGs in `regression/` are the baseline captured through the omp browser relay.

Any change to a UI element requires a new screenshot of every page that shows that element. Replace the file for that page. Do not add a date or a suffix. Commit the new PNG with the change. A UI change without the new screenshot is not done.

### Capture

Start a server that does not write the product snapshot into `data/`. Without SMTP credentials, sign-in and session-invite links go to `data/magic-link-outbox.jsonl`, and Withdraw links go to `data/withdraw-outbox.jsonl`; do not commit those files.

```
cmd /c "set PORT=3477&& set DATABASE_URL=sqlite::memory:&& set SMTP_USER=&& set SMTP_PASSWORD=&& npm start"
```

From the agent eval kernel, open the omp relay against that server. The screenshot is of that live page. A headless browser does not count. This uses the user's Chrome through the relay and leaves their other tabs alone:

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

Start in a signed-out browser and save `sign-in.png`. Fill the email, submit, and open the last `/magic?token=...` line in `data/magic-link-outbox.jsonl`. Before clicking `Confirm sign in`, save `magic-link-confirmation.png` with the form visible. Click `Confirm sign in` to complete sign-in. While Home still asks for a display name, set it to Relay. Open Profile, change the display name, and verify the greeting and field update, then restore Relay. Save `home.png` with the name set, the greeting, and no change form. Save `profile.png` with the name and the change control, and the menu closed.

After sign-in, reopen the original magic URL and verify the existing “That magic link is no longer valid.” message. Repeat with an expired token; it must show the same message.

Then, in order:

1. Library, then Crossword `First Row`. Save `crossword.png` before starting the Session.
2. Start the Session and open Invite to verify the invite code. Save `session.png` with the top row empty and the dialog open, then close the dialog. Verify square cells at desktop (1162×1028), portrait (390×844), and landscape (844×390) viewports; the board stays at least 20rem wide where its container allows it, with no horizontal overflow.
3. Match the Grid. Select sets the Square from the index field. Type writes the letter onto that selected Square, not onto the index. For squares 0 through 8, Select, then Type `A`. The last Type opens `/match`.
4. Completions, then Publish. Publish the same nine-A Freestyle Crossword as title Tiny and Author Ada. Open Published, follow Preview, and verify the published grid; return and open the Revise link from the confirmation.
5. About, then Support. Help is a separate signed-out shot: open `/help` with no Player cookie and the menu closed, and save `regression/help.png`. Do not recapture the other pages for the Help link; it sits in the closed menu.
6. Build. Verify the grid stays on the left with options on the right. Right-click a square to toggle it black, right-click again to clear it, and confirm clue numbers update. Use keyboard `#` as the touch-accessible fallback. Select Standard; verify the rules appear and blacking/unblacking one square toggles its 180° opposite. Save `build.png` with the rules and mirrored blocks visible. Continue with a small Freestyle crossing layout; verify Across/Down clues appear on the right in Session style, click a clue to edit it in a wrapping textarea, then confirm Enter and blur both restore the clue line and keep the text. Verify Back and Publish share a row above the footer rule. Continue with a 9×9 Standard grid and attempt Publish; confirm the size error is shown and the puzzle is not published. Save `build-clues.png` with the clue layout and validation message visible.
7. Use `tab.run` to submit a temporary browser form to `/sign-in` with a hidden `pad` field of 262145 characters. Verify the “That request is too large.” response and save `regression/request-too-large.png`.
8. The initial sign-in already used one global slot. From the signed-out origin, use same-origin `fetch` POSTs to `/sign-in` with 49 distinct addresses to fill the 50/hour cap, then submit a browser form POST for one more address. Verify the 429 page shows “Too many sign-in emails” with retry seconds and that the response `Retry-After` header matches. Save `regression/rate-limited-sign-in.png`.

Close the relay tab with `browser.close(name="coopword")`. The memory server holds no snapshot file.

| Page | Path | File |
| --- | --- | --- |
| Sign in | `/` with no Player cookie | `regression/sign-in.png` |
| Magic-link confirmation | `GET /magic?token=...` before the confirmation POST | `regression/magic-link-confirmation.png` |
| Home | `/` after a display name is set | `regression/home.png` |
| Profile | `/profile` | `regression/profile.png` |
| Library | `/library` | `regression/library.png` |
| Crossword | `/crossword?title=` for one Library Crossword | `regression/crossword.png` |
| Published preview | `/crossword?title=Tiny&author=Ada` | `regression/published-preview.png` |
| Build | `/build` | `regression/build.png` |
| Publish | `/publish` | `regression/publish.png` |
| Build clues | `POST /build` after Continue | `regression/build-clues.png` |
| Published | `/published` | `regression/published.png` |
| Revise | `/revise?token=` from a published Crossword | `regression/revise.png` |
| Session | `/session?invite=` for a live Session | `regression/session.png` |
| Match | `/match` after the Grid has matched | `regression/match.png` |
| Completions | `/completions` | `regression/completions.png` |
| About | `/about` | `regression/about.png` |
| Support | `/support` | `regression/support.png` |
| Help | `/help` signed out, menu closed | `regression/help.png` |
| Request too large | `POST /sign-in` body over 256 KiB | `regression/request-too-large.png` |
| Rate-limited sign-in | `POST /sign-in` after the global hour cap | `regression/rate-limited-sign-in.png` |

Fragments (`cell.html`, `clue.html`, `row.html`, and the other partials) are not pages. They show up inside the screenshots above.

A new HTML page that the server returns on its own gets a new row and a new PNG in the same folder, named for that page. A person reviews the committed images against the pages just captured. The pass fails if a listed file is missing, or if a visible page has no row.
