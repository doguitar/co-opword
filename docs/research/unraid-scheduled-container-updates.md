# Research: Unraid scheduled container updates

**Ticket:** [#76](https://github.com/doguitar/co-opword/issues/76)  
**Question:** What supported Unraid mechanism can a repository-resident scheduled script use to update the Co-opword container to a newly promoted immutable GHCR image while preserving Unraid-managed configuration, persistent volumes, environment files, private networking, and rollback control? Identify required plugins or limitations.

**Date:** 2026-11-11

## Verdict

Use the **User Scripts** plugin to schedule a repository-resident script that updates the container’s Unraid template to the promoted GHCR reference (immutable tag or digest), then invokes Unraid’s stock dockerMan updater:

```sh
/usr/bin/php -q /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container "co-opword"
```

That path recreates the container from the saved template, so volume mappings, env vars, network mode, and other template settings are reapplied. Do **not** use `docker pull` + `docker start` alone: that leaves the existing container bound to its old image ID.

**Required plugin:** User Scripts (for scheduling).  
**Optional:** Community Applications (Previous Apps / template restore), CA Auto Update Applications (schedule-driven updates that share the same dockerMan path, but are a poor fit for promotion-driven single-image deploys).

## Findings

### 1. Unraid stores config in flash templates; data lives outside the container

- Installing/editing a container writes an XML template on the boot device. That template is reused for edit and reinstall (Previous Apps). ([Unraid Docker Management](https://docs.unraid.net/unraid-os/manual/docker-management/))
- Templates for user containers live under `/boot/config/plugins/dockerMan/templates-user`. ([Unraid Community Applications manual](https://docs.unraid.net/unraid-os/manual/applications/); Squid on templates after OS upgrade, [forum](https://forums.unraid.net/topic/190629-all-containers-missing-after-os-upgrade-retrieve-old-template-file/))
- Official guidance: keep application data in host mappings (typically `appdata`) so updates/reinstalls do not wipe settings. ([Managing & customizing containers](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/); [Docker troubleshooting](https://docs.unraid.net/unraid-os/troubleshooting/common-issues/docker-troubleshooting/))
- Docker volumes outlive the container filesystem; destroying/recreating a container does not destroy named/bind-mounted data. ([Docker Volumes](https://docs.docker.com/engine/storage/volumes/))

**Implication for Co-opword:** SQLite/env secrets must be host-mapped (or template Extra Parameters / env entries). Updating the image recreates the container process, not the mapped paths.

### 2. Scheduling is not built into Unraid Docker; User Scripts is the documented mechanism

- Unraid docs state scheduled start/stop is **not** a native Docker feature and recommend the **User Scripts** plugin (Apps → install; Settings → User Scripts; cron/custom schedule). Documented commands are `docker start|stop|restart`. ([Managing & customizing containers — Scheduling start and stop](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/))
- Squid (CA Auto Update author/admin): for **multiple update schedules**, use User Scripts. ([CA Application Auto Update, Jan 2025](https://forums.unraid.net/topic/51959-plugin-ca-application-auto-update/page/18/#comment-1507503))

**Implication:** A repo-resident updater script is scheduled by User Scripts (script body can be synced from the git checkout onto the flash User Scripts store, or invoked from a share path the User Scripts job calls).

### 3. The supported recreate path is dockerMan `update_container`, not pull+start

- Community-confirmed CLI used by the WebGUI update flow:

  `/usr/bin/php -q /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container "$CONTAINER_NAME"`

  ([forum thread](https://forums.unraid.net/topic/195445-is-there-a-cli-command-to-update-containers/))
- Squid earlier published the same underlying approach (drive `CreateDocker.php` with `updateContainer`) for cron/User Scripts, later packaged as CA Auto Update; he also pointed script authors at the Auto Update plugin’s `updateDocker.php` or Auto Update itself. ([CA Auto Update OP / early script](https://forums.unraid.net/topic/51959-plugin-ca-application-auto-update/); [Invoke Update All from script](https://forums.unraid.net/topic/115364-invoke-docker-update-all-button-from-script/))
- Third-party Docker Batch Update (community plugin) states it has **no update logic of its own** and hands work to Unraid’s `update_container`: pull image → stop if running → **recreate from template** → start if previously running → remove unused old image. ([plugin thread](https://forums.unraid.net/topic/200997-plugin-docker-batch-update-update-only-the-containers-you-pick-in-one-go/))

**Anti-pattern:** `docker stop` → `docker pull` → `docker start` (as sketched in the Auto Update thread) does not recreate the container from the new image layers. Use `update_container` (or equivalent dockerMan recreate) after the template Repository field points at the promoted reference.

### 4. Networking and “private” networks

- Template network types: Bridge (default isolated Docker network + mapped ports), Host, None, Custom (macvlan/ipvlan). Env vars, ports, and volume maps are also template fields. ([Managing & customizing containers](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/); [Docker Management](https://docs.unraid.net/unraid-os/manual/docker-management/))
- Unraid **7.4.0**: templates support **multiple custom networks**, and those attachments are **retained when containers are updated or recreated**. Registry update checks also improved for OCI manifests. ([7.4.0 release notes](https://docs.unraid.net/unraid-os/release-notes/7.4.0/))
- **Limitation:** Custom Docker networks do **not** survive deletion of `docker.img`; recreate networks with the **same names** before re-adding containers. ([Docker troubleshooting](https://docs.unraid.net/unraid-os/troubleshooting/common-issues/docker-troubleshooting/); [Docker Management — Custom Networks](https://docs.unraid.net/unraid-os/manual/docker-management/))

### 5. Immutable GHCR images and auth

- GHCR: pull by tag or by **digest** (`image@sha256:…`) for a fixed image. Tags alone are not cryptographically fixed; digests are. Auth for private packages: PAT (classic) with at least `read:packages`, then `docker login ghcr.io`. ([Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry))
- Unraid updates pull whatever Repository string is in the template. For promotion: write the new tag or digest into the template (or Extra Parameters equivalent), then run `update_container`. Keeping the previous digest locally (and/or in the template history) is the rollback handle.

### 6. Rollback control

| Lever | What it restores | Source |
| --- | --- | --- |
| Re-point template Repository to prior digest/tag + `update_container` | Prior image, same Unraid config | GHCR digest + dockerMan |
| Previous Apps / reinstall from saved template | Container + mappings/env/network from flash XML | [Docker troubleshooting](https://docs.unraid.net/unraid-os/troubleshooting/common-issues/docker-troubleshooting/), [Docker Management](https://docs.unraid.net/unraid-os/manual/docker-management/) |
| Host-mapped appdata / volumes | Product data | Unraid + [Docker volumes](https://docs.docker.com/engine/storage/volumes/) |
| Flash backup of `templates-user` | Config XML before bad edits | Squid/trurl [forum](https://forums.unraid.net/topic/190629-all-containers-missing-after-os-upgrade-retrieve-old-template-file/) |

Unraid does not ship first-class “template revision history.” Rollback of **image** is digest/tag control; rollback of **config** is restoring flash XML / Previous Apps. Avoid putting backup XML copies under `templates-user/` (duplicate names confuse the editor). ([templates-user forum](https://forums.unraid.net/topic/170549-docker-templates-user/))

### 7. CA Auto Update Applications (optional alternative)

- Separate CA module: scheduled auto-update of selected plugins/dockers (Daily/Weekly/Monthly/custom cron); can also update during Appdata Backup. ([plugin OP](https://forums.unraid.net/topic/51959-plugin-ca-application-auto-update/))
- Uses dockerMan update machinery; notify via Unraid Notification Settings. ([plugin thread](https://forums.unraid.net/topic/51959-plugin-ca-application-auto-update/))
- **Limitations vs this ticket:** one Docker schedule (not per-promotion); not driven by a repo “promoted digest” file; delay-before-update exists for plugins more than dockers; Compose-managed containers are a poor fit. Prefer User Scripts + `update_container` for Co-opword promotion.

## Recommended mechanism (for the follow-on procedure ticket)

1. **Plugins:** User Scripts required. Community Applications recommended for Previous Apps recovery. CA Auto Update optional/not primary.
2. **Host prep:** Unraid template for `co-opword` with host path for SQLite/data, env (or Extra Parameters for `--env-file` if used), and desired network (bridge or named custom network). Persist GHCR login if the package is private.
3. **Promotion input:** Repo (or deploy share) publishes an immutable GHCR reference (`:prod-<sha>` or `@sha256:…`).
4. **Scheduled job:** User Scripts cron runs a repo-resident script that (a) updates the template Repository to that reference, (b) runs `update_container` for the Co-opword container name, (c) records previous digest for rollback, (d) health-checks before pruning the previous image.
5. **Rollback:** Re-apply prior digest to the template and run `update_container` again; data volumes untouched.

## Tradeoffs

| Approach | Pros | Cons |
| --- | --- | --- |
| **User Scripts + `update_container` (recommended)** | Preserves Unraid template config/networks; scriptable from repo; single-container control; matches WebGUI update | Relies on dockerMan CLI path documented mainly on Unraid forums; script must update template for digest promotion |
| CA Auto Update only | GUI schedule; same recreate semantics | Not promotion-driven; global Docker schedule; weak fit for immutable digest deploys |
| Raw `docker pull` + recreate via hand-built `docker run` | Full CLI control | Bypasses Unraid templates; easy to drop env/network/maps; fights Previous Apps |
| `docker stop` / `pull` / `start` | Simple | **Does not** switch running container to new image |

## Sources

1. https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/
2. https://docs.unraid.net/unraid-os/manual/docker-management/
3. https://docs.unraid.net/unraid-os/troubleshooting/common-issues/docker-troubleshooting/
4. https://docs.unraid.net/unraid-os/manual/applications/
5. https://docs.unraid.net/unraid-os/release-notes/7.4.0/
6. https://forums.unraid.net/topic/195445-is-there-a-cli-command-to-update-containers/
7. https://forums.unraid.net/topic/51959-plugin-ca-application-auto-update/
8. https://forums.unraid.net/topic/51959-plugin-ca-application-auto-update/page/18/
9. https://forums.unraid.net/topic/115364-invoke-docker-update-all-button-from-script/
10. https://forums.unraid.net/topic/200997-plugin-docker-batch-update-update-only-the-containers-you-pick-in-one-go/
11. https://forums.unraid.net/topic/190629-all-containers-missing-after-os-upgrade-retrieve-old-template-file/
12. https://docs.docker.com/engine/storage/volumes/
13. https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
