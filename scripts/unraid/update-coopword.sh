#!/usr/bin/env bash
# Unraid User Scripts updater: promote the latest stable GitHub Release to an
# exact GHCR digest via dockerMan, with pre-update backup and health rollback.
set -euo pipefail

CONTAINER="${COOPWORD_CONTAINER:-co-opword}"
IMAGE="ghcr.io/doguitar/co-opword"
GITHUB_REPO="doguitar/co-opword"
TEMPLATE="${COOPWORD_TEMPLATE:-/boot/config/plugins/dockerMan/templates-user/my-co-opword.xml}"
HEALTH_TIMEOUT_SEC="${COOPWORD_HEALTH_TIMEOUT_SEC:-180}"
HEALTH_POLL_SEC="${COOPWORD_HEALTH_POLL_SEC:-5}"
UPDATE_PHP="${COOPWORD_UPDATE_PHP:-/usr/bin/php}"
UPDATE_SCRIPT="${COOPWORD_UPDATE_SCRIPT:-/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container}"

DIGEST_RE='^sha256:[a-f0-9]{64}$'

log() {
  printf '%s\n' "$*" >&2
}

die() {
  log "error: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

json_string_field() {
  local json="$1" field="$2"
  printf '%s\n' "$json" | awk -v key="\"${field}\"" '
    {
      position = index($0, key)
      if (position == 0) next
      value = substr($0, position + length(key))
      if (!match(value, /^[[:space:]]*:[[:space:]]*"/)) next
      value = substr(value, RSTART + RLENGTH)
      end = index(value, "\"")
      if (end > 0) {
        print substr(value, 1, end - 1)
        exit
      }
    }
  '
}

assert_digest() {
  local value="$1" label="$2"
  [[ "$value" =~ $DIGEST_RE ]] || die "${label} is not a valid sha256 digest"
}

assert_image_pin() {
  local value="$1" label="$2"
  local prefix="${IMAGE}@"
  case "$value" in
    "${prefix}"sha256:*) ;;
    *) die "${label} is not a digest pin for ${IMAGE}" ;;
  esac
  local digest="${value#"$prefix"}"
  assert_digest "$digest" "$label digest"
}

read_template_repository() {
  local count repo
  count="$(grep -c '<Repository>' "$TEMPLATE" || true)"
  [[ "$count" == "1" ]] || die "template Repository count must be 1 (found ${count})"
  repo="$(sed -n 's:.*<Repository>\(.*\)</Repository>.*:\1:p' "$TEMPLATE" | head -n1)"
  [[ -n "$repo" ]] || die "template Repository is empty"
  printf '%s\n' "$repo"
}
assert_container_name() {
  local value="$1" label="$2"
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "${label} is not a valid Docker container name"
}

read_template_name() {
  local count name
  count="$(grep -c '<Name>' "$TEMPLATE" || true)"
  [[ "$count" == "1" ]] || die "template Name count must be 1 (found ${count})"
  name="$(sed -n 's:.*<Name>\(.*\)</Name>.*:\1:p' "$TEMPLATE" | head -n1)"
  [[ -n "$name" ]] || die "template Name is empty"
  assert_container_name "$name" "template Name"
  printf '%s\n' "$name"
}

set_template_repository() {
  local new_repo="$1" tmp written_repo
  tmp="$(mktemp "${TEMPLATE}.tmp.XXXXXX")" || die "failed to create template temporary file"
  if ! cp -p "$TEMPLATE" "$tmp"; then
    rm -f "$tmp"
    die "failed to preserve template attributes"
  fi
  if ! sed "s|<Repository>.*</Repository>|<Repository>${new_repo}</Repository>|" "$TEMPLATE" >"$tmp"; then
    rm -f "$tmp"
    die "failed to write template temporary file"
  fi
  written_repo="$(sed -n 's:.*<Repository>\(.*\)</Repository>.*:\1:p' "$tmp" | head -n1)"
  if [[ "$written_repo" != "$new_repo" ]]; then
    rm -f "$tmp"
    die "template Repository replacement did not match requested pin"
  fi
  if ! mv -f "$tmp" "$TEMPLATE"; then
    rm -f "$tmp"
    die "failed to atomically replace Unraid template"
  fi
}

resolve_target_digest() {
  local release_json tag commit_json commit_sha token_json token headers digest
  release_json="$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest")" \
    || die "failed to fetch latest stable GitHub Release"
  tag="$(json_string_field "$release_json" "tag_name")"
  [[ -n "$tag" ]] || die "latest stable release is missing tag_name"
  [[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || die "latest stable release has an invalid tag_name"

  # Resolve the release tag to its commit SHA. Do not use target_commitish.
  commit_json="$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/commits/${tag}")" \
    || die "failed to resolve release tag ${tag} to a commit"
  commit_sha="$(json_string_field "$commit_json" "sha")"
  [[ "$commit_sha" =~ ^[a-f0-9]{40}$ ]] || die "release tag ${tag} did not resolve to a 40-hex commit SHA"

  token_json="$(curl -fsSL --get \
    --data-urlencode "service=ghcr.io" \
    --data-urlencode "scope=repository:${IMAGE#ghcr.io/}:pull" \
    "https://ghcr.io/token")" \
    || die "failed to obtain anonymous GHCR pull token"
  token="$(json_string_field "$token_json" "token")"
  [[ -n "$token" ]] || die "GHCR anonymous pull token response is missing token"
  headers="$(curl -fsS -I \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/${IMAGE#ghcr.io/}/manifests/${commit_sha}")" \
    || die "failed to resolve GHCR digest for commit ${commit_sha}"
  digest="$(printf '%s\n' "$headers" | tr -d '\r' | sed -n 's/[Dd]ocker-[Cc]ontent-[Dd]igest:[[:space:]]*//p' | head -n1)"
  assert_digest "$digest" "GHCR digest for ${commit_sha}"
  log "stable release ${tag} commit ${commit_sha} digest ${digest}"
  printf '%s\n' "$digest"
}

container_image() {
  docker inspect --format='{{.Config.Image}}' "$CONTAINER"
}

data_mount_source() {
  docker inspect --format='{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$CONTAINER"
}

container_health() {
  docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || true
}

wait_for_health() {
  local deadline status
  deadline="$((SECONDS + HEALTH_TIMEOUT_SEC))"
  while (( SECONDS < deadline )); do
    status="$(container_health)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" ]]; then
      return 1
    fi
    sleep "$HEALTH_POLL_SEC"
  done
  return 1
}

run_update_container() {
  "$UPDATE_PHP" -q "$UPDATE_SCRIPT" "$CONTAINER"
}

backup_current() {
  local current_digest="$1" label out path
  label="sha256-${current_digest#sha256:}"
  out="$(docker exec "$CONTAINER" npm run backup -- --label "$label")" \
    || die "pre-update backup failed"
  printf '%s\n' "$out" | grep -q 'quick_check ok' || die "pre-update backup failed quick_check"
  path="$(printf '%s\n' "$out" | sed -n 's|^\(/app/data/backups/[^[:space:]]*\.sqlite\)$|\1|p' | tail -n1)"
  [[ -n "$path" ]] || die "pre-update backup path missing from output"
  log "backup ok ${path}"
  printf '%s\n' "$path"
}

restore_backup_on_host() {
  local data_dir="$1" container_backup_path="$2" host_backup restore_tmp
  host_backup="${data_dir}/backups/$(basename "$container_backup_path")"
  [[ -f "$host_backup" ]] || die "verified backup missing on host data mount"
  restore_tmp="$(mktemp "${data_dir}/.coopword.sqlite.restore.XXXXXX")" \
    || die "failed to create SQLite restore temporary file"
  if ! cp -p "$host_backup" "$restore_tmp"; then
    rm -f "$restore_tmp"
    die "failed to copy verified SQLite backup"
  fi
  if ! rm -f "${data_dir}/coopword.sqlite-wal" "${data_dir}/coopword.sqlite-shm"; then
    rm -f "$restore_tmp"
    die "failed to remove SQLite sidecars before restore"
  fi
  if ! mv -f "$restore_tmp" "${data_dir}/coopword.sqlite"; then
    rm -f "$restore_tmp"
    die "failed to atomically restore SQLite database"
  fi
  log "restored sqlite from $(basename "$host_backup")"
}

rollback() {
  local prior_ref="$1" data_dir="$2" backup_path="$3"
  log "update unhealthy; rolling back to ${prior_ref}"
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker stop "$CONTAINER" || die "failed to stop unhealthy container before restore"
  else
    docker info >/dev/null 2>&1 || die "Docker daemon unavailable during rollback"
    log "failed container already removed; proceeding with rollback"
  fi
  restore_backup_on_host "$data_dir" "$backup_path"
  set_template_repository "$prior_ref"
  run_update_container || die "rollback recreate via dockerMan failed"
  wait_for_health || die "rollback container failed health check"
  die "update failed; rolled back to ${prior_ref}"
}
validate_health_settings() {
  [[ "$HEALTH_TIMEOUT_SEC" =~ ^[0-9]+$ ]] \
    || die "COOPWORD_HEALTH_TIMEOUT_SEC must be a positive base-10 integer"
  [[ "$HEALTH_POLL_SEC" =~ ^[0-9]+$ ]] \
    || die "COOPWORD_HEALTH_POLL_SEC must be a positive base-10 integer"
  HEALTH_TIMEOUT_SEC="$((10#$HEALTH_TIMEOUT_SEC))"
  HEALTH_POLL_SEC="$((10#$HEALTH_POLL_SEC))"
  (( HEALTH_TIMEOUT_SEC > 0 )) \
    || die "COOPWORD_HEALTH_TIMEOUT_SEC must be greater than zero"
  (( HEALTH_POLL_SEC > 0 )) \
    || die "COOPWORD_HEALTH_POLL_SEC must be greater than zero"
}

main() {
  validate_health_settings
  require_cmd curl
  require_cmd docker
  [[ -x "$UPDATE_PHP" ]] || die "missing dockerMan php interpreter: ${UPDATE_PHP}"
  [[ -e "$UPDATE_SCRIPT" ]] || die "missing dockerMan update_container: ${UPDATE_SCRIPT}"
  [[ -f "$TEMPLATE" ]] || die "missing Unraid template: ${TEMPLATE}"
  assert_container_name "$CONTAINER" "COOPWORD_CONTAINER"

  local template_name template_repo running_repo data_dir target_digest target_ref
  template_repo="$(read_template_repository)"
  template_name="$(read_template_name)"
  [[ "$template_name" == "$CONTAINER" ]] \
    || die "template Name and COOPWORD_CONTAINER disagree"
  assert_image_pin "$template_repo" "template Repository"
  running_repo="$(container_image)"
  assert_image_pin "$running_repo" "running container image"
  [[ "$template_repo" == "$running_repo" ]] \
    || die "template Repository and running container image disagree"

  data_dir="$(data_mount_source)"
  [[ -n "$data_dir" ]] || die "container is missing a host bind for /app/data"
  [[ -d "$data_dir" ]] || die "/app/data host path is not a directory"
  [[ -f "${data_dir}/coopword.sqlite" ]] || die "missing database at /app/data/coopword.sqlite"

  target_digest="$(resolve_target_digest)"
  target_ref="${IMAGE}@${target_digest}"

  if [[ "$template_repo" == "$target_ref" && "$running_repo" == "$target_ref" ]]; then
    log "already current at ${target_ref}; no-op"
    exit 0
  fi

  local prior_ref current_digest backup_path
  prior_ref="$template_repo"
  current_digest="${prior_ref#${IMAGE}@}"
  backup_path="$(backup_current "$current_digest")"

  set_template_repository "$target_ref"
  log "pinned template to ${target_ref}"
  run_update_container || {
    log "dockerMan update failed; attempting rollback"
    rollback "$prior_ref" "$data_dir" "$backup_path"
  }

  if wait_for_health; then
    log "update healthy at ${target_ref}"
    exit 0
  fi

  rollback "$prior_ref" "$data_dir" "$backup_path"
}

main "$@"
