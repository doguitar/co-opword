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
    reverse_proxy 127.0.0.1:3000
}
```

Caddy provisions HTTPS. The app sets `Secure` on the Player cookie in production; do not expose port 3000 directly or run production without HTTPS.

## Database and recovery

The SQLite database at `/var/lib/co-opword/coopword.sqlite` is the single source of durable product state. Back up that file to storage outside the host. A safe manual backup stops the service briefly:

```sh
systemctl stop co-opword
cp /var/lib/co-opword/coopword.sqlite /var/backups/coopword-$(date +%F-%H%M%S).sqlite
systemctl start co-opword
```

Restore by stopping the service, replacing the database with a known-good copy owned by `co-opword`, and starting the service. Schedule backups and test restores before inviting users. Postgres and MySQL snapshot adapters exist, but this app still requires a single process; a database alone does not provide multi-instance coordination.

## Operations

- Run `npm test` and `npm run typecheck` before deployment; CI runs both on pushes and pull requests.
- Use `journalctl -u co-opword` for the Node process log.
- The Node process rejects request bodies larger than 256 KiB (262144 bytes) with HTTP 413. A declared `Content-Length` over the cap is refused before routing; an oversize body discovered while reading is refused before form parsing or product calls.
- The application has no health endpoint, automated backup job, or graceful-shutdown handler yet. Monitor the service process and verify backups manually; add these before relying on unattended recovery.
