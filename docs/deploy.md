# Production deployment

This app is a single Node process. Start one instance only: product state and Session event streams are in memory; a shared database does not make multiple instances safe.

## Host

Use one Linux host with a persistent disk, Node.js 24, systemd, and Caddy (or another HTTPS reverse proxy). Keep the process bound to localhost; expose only the proxy. The server runs the TypeScript source directly through Node's type stripping, so there is no build step.

Install dependencies from a release checkout:

```sh
npm ci
npm test
npm run typecheck
```

Create a dedicated service account and data directory, then set `/etc/co-opword/environment` to mode `0600` and owned by root:

```ini
NODE_ENV=production
PORT=3000
DATABASE_URL=sqlite:/var/lib/co-opword/coopword.sqlite
PUBLIC_URL=https://coopword.example.com
SMTP_HOST=smtp.purelymail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=donotreply@updo.gg
SMTP_PASSWORD=replace-with-secret
MAIL_FROM=donotreply@updo.gg
```

The mail transport uses Purelymail SMTP. Keep the SMTP password out of the repository and process logs; use a Purelymail app password where available. `PUBLIC_URL` must be the public HTTPS origin with no path.

Example `/etc/systemd/system/co-opword.service`:

```ini
[Unit]
Description=Co-opword
After=network.target

[Service]
Type=simple
User=co-opword
Group=co-opword
WorkingDirectory=/opt/co-opword
EnvironmentFile=/etc/co-opword/environment
ExecStart=/usr/bin/npm start
Restart=on-failure
TimeoutStopSec=30
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/co-opword

[Install]
WantedBy=multi-user.target
```

Create `/var/lib/co-opword` owned by the service account. Adjust the npm path and checkout path for the host. Enable the unit with `systemctl enable --now co-opword`.

Example Caddy site:

```caddy
coopword.example.com {
    respond /health 404
    reverse_proxy 127.0.0.1:3000
}
```

Caddy provisions HTTPS. The app sets `Secure` on the Player cookie in production; do not expose port 3000 directly or run production without HTTPS. The Node process also sends Content-Security-Policy, framing denial, `X-Content-Type-Options`, and Referrer-Policy on HTML and Session event-stream replies; leave HSTS to the HTTPS proxy after TLS is verified.

## Container image

GitHub Actions publishes the production image to GHCR (`ghcr.io/doguitar/co-opword`). Pin deployments to the exact OCI digest (`ghcr.io/doguitar/co-opword@sha256:…`); that digest is the deployment identity. Commit-SHA tags are discovery labels only—use them to find the digest for a given commit, not as the pin. Do not use a `latest` tag.

The first GHCR publish creates the package as private; `docker push` cannot change visibility. After that first publish (on `master` or a published release—not from this draft PR), an owner must set the package to Public once in the GitHub package settings so anonymous pulls work. Public package visibility cannot be reverted to private. See [Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

The image runs Node 24 as non-root `node`, serves TypeScript directly via `npm start`, keeps durable state under the `/app/data` volume, and health-checks `http://127.0.0.1:$PORT/health` from inside the container. Pass runtime config (including `DATABASE_URL=sqlite:/app/data/coopword.sqlite`) via the environment or a mounted env file; do not bake secrets into the image.

## Database and recovery

The SQLite database at `/var/lib/co-opword/coopword.sqlite` is the single source of durable product state. File-backed SQLite uses WAL; never copy the main database file by itself because committed writes can remain in `coopword.sqlite-wal`. Take consistent online backups with the in-container Node command; do not stop the service to copy the live file, and do not expose the backup directory over HTTP.

For a container deployment, run from the host while the app container is running:

```sh
docker exec co-opword npm run backup
```

Optional path-safe updater label, normalized from an image digest by replacing `:` with `-` (example):

```sh
docker exec co-opword npm run backup -- --label sha256-0123456789abcdef
```

The command writes a timestamped SQLite backup beside the appdata database under `backups/`, prints `PRAGMA quick_check` status for that destination, and—only after verification—prunes this app's backups older than 30 days. Failures leave the live database and previous known-good backups untouched.

Schedule that command daily on the host (cron, Unraid user script, or equivalent), and retain stdout/stderr so each `quick_check` result and backup path are recorded. There is no in-app backup scheduler.

Before inviting users, test an isolated restore:

1. Copy a selected backup to a scratch `coopword.sqlite`; never overwrite or mount the live database.
2. Start a disposable container from the same image with only the scratch directory mounted at `/app/data`, a distinct container name, and no public port. Set `NODE_ENV=production`, `DATABASE_URL=sqlite:/app/data/coopword.sqlite`, `PUBLIC_URL=https://restore.invalid`, and disposable `SMTP_USER` / `SMTP_PASSWORD` values.
3. Confirm the container becomes healthy and expected data opens. Stop/remove the container and delete the scratch copy.

Backups stay in the local appdata `backups/` folder for now. Off-host rclone sync is out of scope; until it is configured, host or storage loss can destroy both the database and its backups.

Restore into production by stopping the service, moving the existing database and any `coopword.sqlite-wal` / `coopword.sqlite-shm` sidecars aside, copying a verified backup into `coopword.sqlite` with ownership `co-opword`, and starting the service. Keep the old files until the restored app is verified. Postgres and MySQL snapshot adapters exist, but this app still requires a single process; a database alone does not provide multi-instance coordination.

## Unraid scheduled updater

On Unraid, schedule the repository script `scripts/unraid/update-coopword.sh` with the **User Scripts** plugin (Settings → User Scripts). Point the job at the script on a persistent share (or paste/sync it into the User Scripts store) and run it during a maintenance window. Host prerequisites are `bash`, `curl`, `docker`, Unraid’s stock core utilities (including `awk`), and the dockerMan PHP helper below. Do not install extra JSON tools; the script parses the small GitHub/GHCR responses it needs without `jq`.

Default template path is `/boot/config/plugins/dockerMan/templates-user/my-co-opword.xml`. Override with `COOPWORD_TEMPLATE` when the saved name differs. `COOPWORD_HEALTH_TIMEOUT_SEC` defaults to `180` and `COOPWORD_HEALTH_POLL_SEC` to `5`; both must be positive base-10 integers. The script requires a single `<Repository>` pin of the form `ghcr.io/doguitar/co-opword@sha256:…` that matches the running container’s `Config.Image`, a host bind for `/app/data` containing `coopword.sqlite`, and the dockerMan updater at `/usr/bin/php -q /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container co-opword` (`COOPWORD_UPDATE_PHP` / `COOPWORD_UPDATE_SCRIPT` override the paths). It fails closed—without editing the template or recreating the container—when the latest stable GitHub Release, commit SHA, GHCR digest, template, dockerMan command, current digest pin, or data mount is missing or inconsistent.

The default container name is `co-opword`, matching the template’s `<Name>`. Set `COOPWORD_CONTAINER` to the same valid Docker name when it differs; the updater fails before mutation if the configured name and template disagree. GHCR manifest lookup uses an anonymous pull token, so the image package must be public. The token is held in memory only and is never logged or persisted.

When a newer stable release resolves to a new digest, the script takes an online backup labeled `sha256-<hex>` from the current digest (`docker exec co-opword npm run backup -- --label …`, which already runs `quick_check` and keeps the 30-day set), pins the template Repository to the target digest, invokes `update_container`, and waits until the container reports `healthy`. On update or health failure it stops the failed container when present (checking that Docker remains reachable if dockerMan removed it), restores that verified SQLite backup on the host data mount (removing stale `coopword.sqlite-wal` / `coopword.sqlite-shm`), repoints the template to the prior digest, recreates through dockerMan, verifies health, and exits nonzero. Rollback intentionally discards writes after the pre-update backup. Never run two app instances; dockerMan recreates the single configured container (default name `co-opword`) from the template.

`update_container` is an unversioned Unraid dockerMan implementation detail, not a published public API. Confirm the PHP path still exists after Unraid upgrades before relying on the schedule. Scenario tests under `scripts/unraid/update-coopword.test.ts` exercise the script with fake `curl` / `docker` / `php` commands; they do not replace a one-time live-host validation on the actual Unraid box (release resolution, template path, dockerMan recreate, backup, health, and rollback).

## Operations

- Run `npm test` and `npm run typecheck` before deployment; CI runs both on pushes and pull requests.
- Use `journalctl -u co-opword` for the Node process log. Application lifecycle and errors go to stdout/stderr; logs name configuration keys when startup validation fails and never print secret or config values.
- When `NODE_ENV=production`, startup requires a file-backed SQLite `DATABASE_URL` (in-memory SQLite is rejected), HTTPS `PUBLIC_URL`, `SMTP_USER`, and `SMTP_PASSWORD`, and validates `PORT` / `SMTP_PORT` / `SMTP_SECURE` syntax when those are set. `PORT` defaults to `3000`; SMTP host/port/TLS and `MAIL_FROM` keep their Purelymail-compatible defaults. SMTP network reachability is not checked at startup.
- `GET /health` is loopback-only. It returns plain `healthy` (200) or `unhealthy` (503) after a lightweight SQLite usability check and does not expose paths, credentials, or diagnostics. Point the container health check at `http://127.0.0.1:$PORT/health`; do not publish this route through the reverse proxy.
- On `SIGTERM`, the process stops accepting new work, ends Session event streams, lets in-flight request and snapshot writes finish, and exits within 30 seconds (force-closing leftovers at that bound). Repeated `SIGTERM` is ignored after shutdown has started. `systemctl stop` / Docker stop should use a stop timeout of at least 30 seconds.
- The Node process rejects request bodies larger than 256 KiB (262144 bytes) with HTTP 413. A declared `Content-Length` over the cap is refused before routing; an oversize body discovered while reading is refused before form parsing or product calls.
- Unauthenticated sign-in magic-link emails are capped in-process: one per normalized address per 60 seconds, five per address per rolling hour, and 50 per rolling hour globally. Exceeded limits return HTTP 429 with `Retry-After` and the same retry copy for known and unknown addresses. Counters are memory-only and reset when the process restarts; client IPs are not recorded. One-time sign-in and invite tokens expire 24 hours after issuance. Authenticated invite emails are not counted against the issuance caps.
- Monitor the service process and container health.
