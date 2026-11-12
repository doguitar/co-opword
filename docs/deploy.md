# Production deployment

This app is a single Node process. Start one instance only: product state and Session event streams are in memory; a shared database does not make multiple instances safe.

## Unraid + nginx

Run one Co-opword container and nginx on the same user-defined Docker network. Terminate TLS at nginx; use HTTP only between nginx and the app on that private network. Do not publish the app's port. Product state and Session event streams are in memory, so a shared database does not make multiple app instances safe.

Create the network and persistent paths on the Unraid host:

```sh
docker network inspect coopword-private >/dev/null 2>&1 || docker network create coopword-private
install -d -o 1000 -g 1000 -m 700 /mnt/user/appdata/coopword/data
touch /mnt/user/appdata/coopword/coopword.env
chown 1000:1000 /mnt/user/appdata/coopword/coopword.env
chmod 600 /mnt/user/appdata/coopword/coopword.env
vi /mnt/user/appdata/coopword/coopword.env
stat -c '%a %u:%g %n' /mnt/user/appdata/coopword/data /mnt/user/appdata/coopword/coopword.env
```

The `node` user in the image is UID/GID `1000`; expect mode `700` on `data` and `600` on the env file. Put these values in the env file, replacing both SMTP placeholders with the production account credentials:

```dotenv
NODE_ENV=production
PORT=3000
DATABASE_URL=sqlite:/app/data/coopword.sqlite
PUBLIC_URL=https://coopword.updo.gg
SMTP_HOST=smtp.purelymail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=replace-with-smtp-username
SMTP_PASSWORD=replace-with-smtp-password
MAIL_FROM=donotreply@updo.gg
```

SMTP host, port, TLS mode, and sender are configurable. Purelymail-compatible defaults are shown; production requires both SMTP credentials. Keep the env file out of the image, logs, and `/app/data`; the backup command copies only the SQLite database. The Node 24 `start` and `backup` scripts load `/run/secrets/coopword.env` if present, and Docker-provided environment values take precedence.

In the Unraid Docker template, configure:

| Setting | Value |
| --- | --- |
| Name | `co-opword` |
| Repository | `ghcr.io/doguitar/co-opword@sha256:<digest-of-a-stable-release>` |
| Network Type | `Custom: coopword-private` |
| Port mappings | None |
| `/mnt/user/appdata/coopword/data` | `/app/data`, read/write |
| `/mnt/user/appdata/coopword/coopword.env` | `/run/secrets/coopword.env`, read-only |

Attach the nginx container to `coopword-private`; publish only its host ports 80 and 443. Configure its certificate/key mounts at the paths below, or substitute the paths used by your certificate manager. For HTTP-01, mount the certificate manager's webroot at `/var/www/certbot` (or change the `root` below to match it); the challenge location serves that path while the redirect stays inside `location /`.

```nginx
server {
    listen 80;
    server_name coopword.updo.gg;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name coopword.updo.gg;

    ssl_certificate /etc/letsencrypt/live/coopword.updo.gg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/coopword.updo.gg/privkey.pem;

    resolver 127.0.0.11 valid=30s ipv6=off;
    set $coopword_backend http://co-opword:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Connection "";

    location = /health {
        return 404;
    }

    location = /session/events {
        proxy_pass $coopword_backend;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    location / {
        proxy_pass $coopword_backend;
    }

    # Enable only after HTTPS and certificate renewal are verified.
    # Bounded to this host: no includeSubDomains or preload.
    # add_header Strict-Transport-Security "max-age=86400" always;
}
```

Before launch, run these checks on the Unraid host:

```sh
docker network inspect coopword-private
test -z "$(docker port co-opword)"
stat -c '%a %u:%g %n' /mnt/user/appdata/coopword/data /mnt/user/appdata/coopword/coopword.env
curl --fail --show-error --silent --output /dev/null https://coopword.updo.gg/
test "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' https://coopword.updo.gg/health)" = 404
```

Run the certificate manager's renewal dry-run (for Certbot, `certbot renew --dry-run`) before enabling the commented HSTS header. The app owns Content-Security-Policy, framing denial, `X-Content-Type-Options`, and Referrer-Policy on HTML and Session event-stream responses; nginx owns HSTS. Verify CSP against actual pages and a live Session SSE before production. The app does not infer `PUBLIC_URL` from forwarded headers or trust arbitrary client-supplied forwarded headers.

## Container image

GitHub Actions publishes the production image to GHCR (`ghcr.io/doguitar/co-opword`). Pin deployments to the exact OCI digest (`ghcr.io/doguitar/co-opword@sha256:…`); that digest is the deployment identity. Commit-SHA tags are discovery labels only—use them to find the digest for a given commit, not as the pin. Do not use a `latest` tag.

The first GHCR publish creates the package as private; `docker push` cannot change visibility. After that first publish (on `master` or a published release—not from this draft PR), an owner must set the package to Public once in the GitHub package settings so anonymous pulls work. Public package visibility cannot be reverted to private. See [Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

The image runs Node 24 as non-root `node`, serves TypeScript directly via `npm start`, keeps durable state under `/app/data`, and health-checks `http://127.0.0.1:$PORT/health` from inside the container. Both `start` and `backup` load the read-only-mounted `/run/secrets/coopword.env` with Node's `--env-file-if-exists`; Docker-provided environment values take precedence. Do not bake secrets into the image.

## Database and recovery

The SQLite database lives at `/app/data/coopword.sqlite`, backed by `/mnt/user/appdata/coopword/data` on the host. SQLite uses WAL; never copy only the live database file because committed writes can remain in `coopword.sqlite-wal`. Take consistent online backups with the in-container Node command, and do not expose the backup directory over HTTP.

Run this from the Unraid host while the app container is running:

```sh
docker exec co-opword npm run backup
```

For an updater backup, the digest-derived label is path-safe:

```sh
docker exec co-opword npm run backup -- --label sha256-0123456789abcdef
```

The command writes a timestamped SQLite backup to `/app/data/backups/` (host path `/mnt/user/appdata/coopword/data/backups/`), prints `PRAGMA quick_check` for the backup, and prunes only this app's backups older than 30 days after verification. It copies database contents only, not the mounted env file. There is no in-app scheduler; schedule `docker exec co-opword npm run backup` daily with Unraid User Scripts and retain its output.

Before launch, perform a restore drill: copy a selected backup to a scratch `coopword.sqlite`; start a disposable container from the same digest with only the scratch directory mounted at `/app/data`, a distinct name, no published port (prefer `--network none`), and a separate env file containing `NODE_ENV=production`, `DATABASE_URL=sqlite:/app/data/coopword.sqlite`, `PUBLIC_URL=https://restore.invalid`, and disposable SMTP credentials. Confirm it becomes healthy and the expected data opens, then remove the container and scratch data. Never use production SMTP credentials for the drill.

Backups stay in the local appdata `backups/` folder. Off-host backup is not configured; host or storage loss can destroy both the database and its backups.

To restore production, stop the container with a 30-second timeout. Move the live `coopword.sqlite` and any `coopword.sqlite-wal` / `coopword.sqlite-shm` sidecars aside, copy a verified backup from `backups/` to `coopword.sqlite`, then set the restored file to owner `1000:1000` and mode `600`. Start the container and verify health and expected data before deleting the old files. If verification fails, stop the container and put the preserved database and matching sidecars back. Restore must not run while the app is writing.

Postgres and MySQL snapshot adapters exist, but this deployment uses SQLite and requires one app process; a database alone does not provide multi-instance coordination.

## Unraid scheduled updater

On Unraid, schedule the repository script `scripts/unraid/update-coopword.sh` with the **User Scripts** plugin (Settings → User Scripts). Point the job at the script on a persistent share (or paste/sync it into the User Scripts store) and run it during a maintenance window. Host prerequisites are `bash`, `curl`, `docker`, Unraid’s stock core utilities (including `awk`), and the dockerMan PHP helper below. Do not install extra JSON tools; the script parses the small GitHub/GHCR responses it needs without `jq`.

Default template path is `/boot/config/plugins/dockerMan/templates-user/my-co-opword.xml`. Override with `COOPWORD_TEMPLATE` when the saved name differs. `COOPWORD_HEALTH_TIMEOUT_SEC` defaults to `180` and `COOPWORD_HEALTH_POLL_SEC` to `5`; both must be positive base-10 integers. The script requires a single `<Repository>` pin of the form `ghcr.io/doguitar/co-opword@sha256:…` that matches the running container’s `Config.Image`, a host bind for `/app/data` containing `coopword.sqlite`, and the dockerMan updater at `/usr/bin/php -q /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container co-opword` (`COOPWORD_UPDATE_PHP` / `COOPWORD_UPDATE_SCRIPT` override the paths). It fails closed—without editing the template or recreating the container—when the latest stable GitHub Release, commit SHA, GHCR digest, template, dockerMan command, current digest pin, or data mount is missing or inconsistent.

The default container name is `co-opword`, matching the template’s `<Name>`. Set `COOPWORD_CONTAINER` to the same valid Docker name when it differs; the updater fails before mutation if the configured name and template disagree. GHCR manifest lookup uses an anonymous pull token, so the image package must be public. The token is held in memory only and is never logged or persisted.

When a newer stable release resolves to a new digest, the script takes an online backup labeled `sha256-<hex>` from the current digest (`docker exec co-opword npm run backup -- --label …`, which already runs `quick_check` and keeps the 30-day set), pins the template Repository to the target digest, invokes `update_container`, and waits until the container reports `healthy`. On update or health failure it stops the failed container when present (checking that Docker remains reachable if dockerMan removed it), restores that verified SQLite backup on the host data mount (removing stale `coopword.sqlite-wal` / `coopword.sqlite-shm`), repoints the template to the prior digest, recreates through dockerMan, verifies health, and exits nonzero. Rollback intentionally discards writes after the pre-update backup. Never run two app instances; dockerMan recreates the single configured container (default name `co-opword`) from the template.

`update_container` is an unversioned Unraid dockerMan implementation detail, not a published public API. Confirm the PHP path still exists after Unraid upgrades before relying on the schedule. Scenario tests under `scripts/unraid/update-coopword.test.ts` exercise the script with fake `curl` / `docker` / `php` commands; they do not replace a one-time live-host validation on the actual Unraid box (release resolution, template path, dockerMan recreate, backup, health, and rollback).

## Operations

- Before launch, send and receive a real magic-link email using the production SMTP settings. SMTP connectivity is not checked at startup.
- Use `docker logs --tail 200 co-opword` for application output. Startup errors name configuration keys without printing secret or config values.
- In production, startup requires a file-backed SQLite `DATABASE_URL`, HTTPS `PUBLIC_URL`, `SMTP_USER`, and `SMTP_PASSWORD`; it validates `PORT`, `SMTP_PORT`, and `SMTP_SECURE` syntax. The image sets `NODE_ENV=production` and `PORT=3000`; SMTP host/port/TLS and `MAIL_FROM` retain their Purelymail-compatible defaults.
- `GET /health` is loopback-only and returns plain `healthy` (200) or `unhealthy` (503) after a lightweight SQLite check. The Docker health check calls `http://127.0.0.1:$PORT/health`; nginx must not expose it publicly.
- On `SIGTERM`, the process stops accepting work, ends Session event streams, waits for in-flight request and snapshot writes, and exits within 30 seconds. Set the Unraid container stop timeout to at least 30 seconds (`docker stop --time 30 co-opword`).
- Run `npm test` and `npm run typecheck` before deployment; CI runs both on pushes and pull requests.
- Request bodies over 256 KiB (262144 bytes) are rejected with HTTP 413 before form parsing or product calls.
- Unauthenticated sign-in emails are capped in-process at one per normalized address per 60 seconds, five per address per rolling hour, and 50 globally per rolling hour. Limits return HTTP 429 with `Retry-After`; counters reset on restart. One-time sign-in and invite tokens expire after 24 hours.
- Monitor container health and retain backup output. Do not run a second app instance.
