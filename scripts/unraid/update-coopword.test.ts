import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const updaterScript = join(here, "update-coopword.sh");

const OLD_HEX = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NEW_HEX = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const OLD_DIGEST = `sha256:${OLD_HEX}`;
const NEW_DIGEST = `sha256:${NEW_HEX}`;
const IMAGE = "ghcr.io/doguitar/co-opword";
const OLD_REF = `${IMAGE}@${OLD_DIGEST}`;
const NEW_REF = `${IMAGE}@${NEW_DIGEST}`;
const TAG = "v9.1.0";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

type BashRuntime = {
  executable: string;
  /** Windows drive letter mapping: WSL uses /mnt/c, Git Bash uses /c. */
  drivePrefix: "mnt" | "msys" | "native";
};

function resolveBash(): BashRuntime | null {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\WINDOWS\\system32\\bash.exe",
          "C:\\Windows\\System32\\bash.exe",
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
          "bash",
        ]
      : ["bash"];
  for (const candidate of candidates) {
    const probe = spawnSync(
      candidate,
      ["-c", 'echo ok; uname -s; if [ -d /mnt/c ]; then echo DRIVE=mnt; elif [ -d /c ]; then echo DRIVE=msys; else echo DRIVE=native; fi'],
      { encoding: "utf8" },
    );
    if (probe.status !== 0 || !(probe.stdout ?? "").includes("ok")) continue;
    const drive = /DRIVE=(mnt|msys|native)/.exec(probe.stdout ?? "")?.[1] as
      | "mnt"
      | "msys"
      | "native"
      | undefined;
    return { executable: candidate, drivePrefix: drive ?? (process.platform === "win32" ? "mnt" : "native") };
  }
  return null;
}

const bash = resolveBash();
const skipReason = bash === null ? "Bash unavailable on this host" : false;

function toBashPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (bash === null || bash.drivePrefix === "native") return normalized;
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (match === null) return normalized;
  const drive = match[1]!.toLowerCase();
  const rest = match[2];
  return bash.drivePrefix === "mnt" ? `/mnt/${drive}/${rest}` : `/${drive}/${rest}`;
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body.replaceAll("\r\n", "\n"), { encoding: "utf8" });
  chmodSync(path, 0o755);
  if (bash !== null) {
    // Ensure WSL/drvfs sees an execute bit for PATH shims.
    spawnSync(bash.executable, ["-c", `chmod +x -- '${toBashPath(path).replaceAll("'", "'\\''")}'`], {
      encoding: "utf8",
    });
  }
}

type Harness = {
  root: string;
  templatePath: string;
  dataDir: string;
  binDir: string;
  stateDir: string;
  updateScriptPath: string;
  phpPath: string;
  env: NodeJS.ProcessEnv;
};

function readState(stateDir: string): Record<string, string> {
  const raw = readFileSync(join(stateDir, "state.env"), "utf8");
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function writeState(stateDir: string, values: Record<string, string>): void {
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(join(stateDir, "state.env"), `${body}\n`, "utf8");
}

function templateXml(repository: string, name: string): string {
  return `<?xml version="1.0"?>\n<Container version="2">\n  <Name>${name}</Name>\n  <Repository>${repository}</Repository>\n  <Network>bridge</Network>\n</Container>\n`;
}

function createHarness(options?: {
  repository?: string;
  runningImage?: string;
  healthAfterUpdate?: "healthy" | "unhealthy";
  releaseTag?: string | null;
  commitSha?: string | null;
  targetDigest?: string | null;
  includeDatabase?: boolean;
  includeDataMount?: boolean;
  includeUpdateScript?: boolean;
  containerName?: string;
  templateName?: string;
  includeGhcrToken?: boolean;
  includeTemplate?: boolean;
  failUpdateAfterRemoval?: boolean;
}): Harness {
  const root = mkdtempSync(join(tmpdir(), "coopword-updater-"));
  const templateDir = join(root, "templates-user");
  const dataDir = join(root, "appdata");
  const binDir = join(root, "bin");
  const stateDir = join(root, "state");
  mkdirSync(templateDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "backups"), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  const templatePath = join(templateDir, "my-co-opword.xml");
  const repository = options?.repository ?? OLD_REF;
  const containerName = options?.containerName ?? "co-opword";
  const templateName = options?.templateName ?? containerName;
  if (options?.includeTemplate !== false) {
    writeFileSync(templatePath, templateXml(repository, templateName), "utf8");
  }

  if (options?.includeDatabase !== false) {
    writeFileSync(join(dataDir, "coopword.sqlite"), "live-db-v1", "utf8");
    writeFileSync(join(dataDir, "coopword.sqlite-wal"), "wal-v1", "utf8");
    writeFileSync(join(dataDir, "coopword.sqlite-shm"), "shm-v1", "utf8");
  }

  const updateScriptPath = join(binDir, "update_container");
  if (options?.includeUpdateScript !== false) {
    writeFileSync(updateScriptPath, "# dockerMan update_container stub\n", "utf8");
  }

  const phpPath = join(binDir, "php");
  const bashDataDir = toBashPath(dataDir);
  const bashStateDir = toBashPath(stateDir);
  const bashTemplatePath = toBashPath(templatePath);

  writeState(stateDir, {
    container_name: containerName,
    image: options?.runningImage ?? repository,
    health: "healthy",
    running: "1",
    health_after_update: options?.healthAfterUpdate ?? "healthy",
    release_tag: options?.releaseTag === null ? "" : (options?.releaseTag ?? TAG),
    commit_sha: options?.commitSha === null ? "" : (options?.commitSha ?? COMMIT),
    target_digest: options?.targetDigest === null ? "" : (options?.targetDigest ?? NEW_DIGEST),
    include_ghcr_token: options?.includeGhcrToken === false ? "0" : "1",
    include_data_mount: options?.includeDataMount === false ? "0" : "1",
    container_exists: "1",
    fail_update_after_removal: options?.failUpdateAfterRemoval === true ? "1" : "0",
    backup_count: "0",
    update_count: "0",
    stop_count: "0",
    curl_release_hits: "0",
    curl_token_hits: "0",
    mutated: "0",
  });

  writeExecutable(
    join(binDir, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${bashStateDir}"
source "$STATE_DIR/state.env"
args="$*"
is_head=0
url=""
for arg in "$@"; do
  case "$arg" in
    -I|-I*|*--head*) is_head=1 ;;
    https://*|http://*) url="$arg" ;;
  esac
done
if [[ "$url" == *"/releases/latest"* ]]; then
  curl_release_hits=$((curl_release_hits + 1))
  printf 'curl_release_hits=%s\n' "$curl_release_hits" >> "$STATE_DIR/state.env"
  if [[ -z "$release_tag" ]]; then
    echo '{"message":"Not Found"}' >&2
    exit 22
  fi
  printf '{"tag_name":"%s","prerelease":false}\n' "$release_tag"
  exit 0
fi
if [[ "$url" == *"/commits/"* ]]; then
  if [[ -z "$commit_sha" ]]; then
    echo '{"message":"Not Found"}' >&2
    exit 22
  fi
  printf '{"sha":"%s","commit":{"message":"release"},"parents":[{"sha":"ffffffffffffffffffffffffffffffffffffffff"}]}\n' "$commit_sha"
  exit 0
fi
if [[ "$url" == "https://ghcr.io/token" ]]; then
  if [[ "$args" != *"service=ghcr.io"* || "$args" != *"scope=repository:doguitar/co-opword:pull"* ]]; then
    echo "wrong GHCR token scope" >&2
    exit 24
  fi
  if [[ "$include_ghcr_token" != "1" ]]; then
    echo '{"errors":[{"code":"DENIED"}]}' >&2
    exit 22
  fi
  curl_token_hits=$((curl_token_hits + 1))
  printf 'curl_token_hits=%s\n' "$curl_token_hits" >> "$STATE_DIR/state.env"
  printf '{"token":"fixture-anonymous-token"}\n'
  exit 0
fi
if [[ "$url" == *"ghcr.io/v2/doguitar/co-opword/manifests/"* ]]; then
  if [[ "$url" != *"/manifests/$commit_sha" ]]; then
    echo "wrong release commit resolved: $url" >&2
    exit 23
  fi
  if [[ "$args" != *"application/vnd.oci.image.manifest.v1+json"* ]]; then
    echo "missing OCI manifest media type in Accept header" >&2
    exit 24
  fi
  if [[ "$args" != *"Authorization: Bearer fixture-anonymous-token"* ]]; then
    echo "missing anonymous GHCR pull token" >&2
    exit 25
  fi
  if [[ -z "$target_digest" ]]; then
    echo 'manifest unknown' >&2
    exit 22
  fi
  if [[ "$is_head" -eq 1 ]]; then
    printf 'HTTP/1.1 200 OK\r\nDocker-Content-Digest: %s\r\nContent-Type: application/vnd.oci.image.manifest.v1+json\r\n\r\n' "$target_digest"
    exit 0
  fi
  printf '{"schemaVersion":2}\n'
  exit 0
fi
echo "unexpected curl: $args" >&2
exit 90
`,
  );

  writeExecutable(
    join(binDir, "docker"),
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${bashStateDir}"
DATA_DIR="${bashDataDir}"
source "$STATE_DIR/state.env"
cmd="\${1:-}"
shift || true
case "$cmd" in
  inspect)
    format=""
    name=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --format) format="$2"; shift 2 ;;
        --format=*) format="\${1#--format=}"; shift ;;
        *) name="$1"; shift ;;
      esac
    done
    [[ "$name" == "$container_name" ]] || { echo "no such container: $name" >&2; exit 1; }
    [[ "$container_exists" == "1" ]] || { echo "no such container: $name" >&2; exit 1; }
    [[ -n "$format" ]] || exit 0
    if [[ "$format" == *"Config.Image"* ]]; then
      printf '%s\n' "$image"
      exit 0
    fi
    if [[ "$format" == *"Mounts"* ]] || [[ "$format" == *"/app/data"* ]]; then
      if [[ "$include_data_mount" != "1" ]]; then
        printf '\n'
        exit 0
      fi
      printf '%s\n' "$DATA_DIR"
      exit 0
    fi
    if [[ "$format" == *"Health.Status"* ]] || [[ "$format" == *"State.Health"* ]]; then
      printf '%s\n' "$health"
      exit 0
    fi
    if [[ "$format" == *"State.Status"* ]] || [[ "$format" == *"State.Running"* ]]; then
      if [[ "$running" == "1" ]]; then printf 'running\n'; else printf 'exited\n'; fi
      exit 0
    fi
    echo "unexpected docker inspect format: $format" >&2
    exit 91
    ;;
  exec)
    container="\${1:-}"
    [[ "$container" == "$container_name" ]] || { echo "wrong container: $container" >&2; exit 1; }
    shift || true
    label=""
    args="$*"
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--label" ]]; then label="$2"; shift 2; continue; fi
      shift
    done
    [[ -n "$label" ]] || { echo "backup label missing" >&2; exit 1; }
    [[ "$args" == *"npm run backup -- --label"* ]] || { echo "unexpected backup command" >&2; exit 1; }
    [[ "$running" == "1" ]] || { echo "container not running" >&2; exit 1; }
    backup_count=$((backup_count + 1))
    stamp="2026-05-01T10-00-00Z"
    host_backup="$DATA_DIR/backups/coopword-\${stamp}-\${label}.sqlite"
    cp "$DATA_DIR/coopword.sqlite" "$host_backup"
    printf 'backup_count=%s\n' "$backup_count" >> "$STATE_DIR/state.env"
    printf 'last_backup_label=%s\\n' "$label" >> "$STATE_DIR/state.env"
    printf 'quick_check ok\n'
    printf '/app/data/backups/coopword-%s-%s.sqlite\n' "$stamp" "$label"
    exit 0
    ;;
  stop)
    [[ "$1" == "$container_name" ]] || { echo "wrong container: $1" >&2; exit 1; }
    [[ "$container_exists" == "1" ]] || { echo "no such container: $1" >&2; exit 1; }
    stop_count=$((stop_count + 1))
    running=0
    health=exited
    {
      printf 'stop_count=%s\n' "$stop_count"
      printf 'running=0\n'
      printf 'health=exited\n'
    } >> "$STATE_DIR/state.env"
    exit 0
    ;;
  info)
    exit 0
    ;;
  *)
    echo "unexpected docker command: $cmd" >&2
    exit 92
    ;;
esac`,
  );

  writeExecutable(
    phpPath,
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${bashStateDir}"
TEMPLATE="${bashTemplatePath}"
source "$STATE_DIR/state.env"
shift || true
script="\${1:-}"
container="\${2:-}"
[[ "$container" == "$container_name" ]] || { echo "bad container $container" >&2; exit 1; }
[[ -f "$script" ]] || { echo "missing update script $script" >&2; exit 1; }
if [[ "$fail_update_after_removal" == "1" && "$update_count" -eq 0 ]]; then
  update_count=$((update_count + 1))
  container_exists=0
  running=0
  health=exited
  {
    printf 'update_count=%s\n' "$update_count"
    printf 'container_exists=0\n'
    printf 'running=0\n'
    printf 'health=exited\n'
    printf 'mutated=1\n'
  } >> "$STATE_DIR/state.env"
  exit 1
fi
repo=$(sed -n 's:.*<Repository>\\(.*\\)</Repository>.*:\\1:p' "$TEMPLATE" | head -n1)
next_health="$health_after_update"
if [[ "$update_count" -ge 1 ]]; then next_health="healthy"; fi
update_count=$((update_count + 1))
mutated=1
container_exists=1
image="$repo"
running=1
health="$next_health"
{
  printf 'update_count=%s\n' "$update_count"
  printf 'container_exists=1\n'
  printf 'mutated=1\n'
  printf 'image=%s\n' "$image"
  printf 'running=1\n'
  printf 'health=%s\n' "$health"
} >> "$STATE_DIR/state.env"
exit 0`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
    COOPWORD_TEMPLATE: templatePath,
    COOPWORD_CONTAINER: containerName,
    COOPWORD_HEALTH_TIMEOUT_SEC: "8",
    COOPWORD_HEALTH_POLL_SEC: "1",
    COOPWORD_UPDATE_PHP: phpPath,
    COOPWORD_UPDATE_SCRIPT: updateScriptPath,
  };

  return {
    root,
    templatePath,
    dataDir,
    binDir,
    stateDir,
    updateScriptPath,
    phpPath,
    env,
  };
}

function runUpdater(harness: Harness): { status: number | null; stdout: string; stderr: string } {
  assert.ok(bash !== null);
  const env: NodeJS.ProcessEnv = {
    ...harness.env,
    COOPWORD_TEMPLATE: toBashPath(harness.templatePath),
    COOPWORD_UPDATE_PHP: toBashPath(harness.phpPath),
    COOPWORD_UPDATE_SCRIPT: toBashPath(harness.updateScriptPath),
    PATH: `${toBashPath(harness.binDir)}:/usr/bin:/bin`,
  };
  if (bash.drivePrefix === "mnt") {
    const forwarded = [
      "COOPWORD_CONTAINER",
      "COOPWORD_TEMPLATE",
      "COOPWORD_HEALTH_TIMEOUT_SEC",
      "COOPWORD_HEALTH_POLL_SEC",
      "COOPWORD_UPDATE_PHP",
      "COOPWORD_UPDATE_SCRIPT",
      "PATH",
    ];
    const existing = (env.WSLENV ?? "")
      .split(":")
      .filter((entry) => entry !== "" && !forwarded.includes(entry.split("/")[0] ?? ""));
    env.WSLENV = [...existing, ...forwarded].join(":");
  }
  const result = spawnSync(bash.executable, [toBashPath(updaterScript)], {
    encoding: "utf8",
    env,
    cwd: harness.root,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${result.error ? String(result.error) : ""}`,
  };
}

function cleanup(harness: Harness): void {
  try {
    rmSync(harness.root, { recursive: true, force: true });
    return;
  } catch (error) {
    if (bash === null) throw error;
    const result = spawnSync(bash.executable, ["-c", 'rm -rf -- "$1"', "cleanup", toBashPath(harness.root)], {
      encoding: "utf8",
    });
    if (result.status !== 0) throw error;
  }
}

test(
  "updater no-op when template and running image already match the stable release digest",
  { skip: skipReason },
  () => {
    const harness = createHarness({
      repository: NEW_REF,
      runningImage: NEW_REF,
      targetDigest: NEW_DIGEST,
    });
    try {
      const beforeTemplate = readFileSync(harness.templatePath, "utf8");
      const beforeDb = readFileSync(join(harness.dataDir, "coopword.sqlite"), "utf8");
      const result = runUpdater(harness);
      assert.equal(result.status, 0, result.stderr);
      assert.match(`${result.stdout}\n${result.stderr}`, /already current|no-op|up to date/i);
      assert.equal(readFileSync(harness.templatePath, "utf8"), beforeTemplate);
      assert.equal(readFileSync(join(harness.dataDir, "coopword.sqlite"), "utf8"), beforeDb);
      const state = readState(harness.stateDir);
      assert.equal(state.update_count, "0");
      assert.equal(state.backup_count, "0");
      assert.equal(state.curl_token_hits, "1");
      assert.equal(state.mutated, "0");
      assert.equal(
        existsSync(join(harness.dataDir, "backups", `coopword-2026-05-01T10-00-00Z-sha256-${NEW_HEX}.sqlite`)),
        false,
      );
    } finally {
      cleanup(harness);
    }
  },
);

test(
  "updater backs up, pins the template digest, recreates through dockerMan, and waits for health",
  { skip: skipReason },
  () => {
    const harness = createHarness({
      repository: OLD_REF,
      runningImage: OLD_REF,
      targetDigest: NEW_DIGEST,
      healthAfterUpdate: "healthy",
      containerName: "co-opword-alt",
    });
    try {
      writeFileSync(join(harness.dataDir, "coopword.sqlite"), "live-before-update", "utf8");
      const result = runUpdater(harness);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(readFileSync(harness.templatePath, "utf8").includes(`<Repository>${NEW_REF}</Repository>`));
      const state = readState(harness.stateDir);
      assert.equal(state.image, NEW_REF);
      assert.equal(state.health, "healthy");
      assert.equal(state.backup_count, "1");
      assert.equal(state.last_backup_label, `sha256-${OLD_HEX}`);
      assert.equal(state.curl_token_hits, "1");
      assert.equal(state.update_count, "1");
      assert.equal(state.stop_count, "0");
      const backupPath = join(
        harness.dataDir,
        "backups",
        `coopword-2026-05-01T10-00-00Z-sha256-${OLD_HEX}.sqlite`,
      );
      assert.equal(existsSync(backupPath), true);
      assert.equal(readFileSync(backupPath, "utf8"), "live-before-update");
      assert.equal(readFileSync(join(harness.dataDir, "coopword.sqlite"), "utf8"), "live-before-update");
      assert.match(`${result.stdout}\n${result.stderr}`, /update healthy|healthy/i);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SMTP_PASSWORD|Authorization:|ghp_[A-Za-z0-9]+|fixture-anonymous-token/);
    } finally {
      cleanup(harness);
    }
  },
);

test(
  "updater rolls back database and prior digest when the new container is unhealthy",
  { skip: skipReason },
  () => {
    const harness = createHarness({
      repository: OLD_REF,
      runningImage: OLD_REF,
      targetDigest: NEW_DIGEST,
      healthAfterUpdate: "unhealthy",
    });
    try {
      writeFileSync(join(harness.dataDir, "coopword.sqlite"), "pre-update-db", "utf8");
      writeFileSync(join(harness.dataDir, "coopword.sqlite-wal"), "stale-wal", "utf8");
      writeFileSync(join(harness.dataDir, "coopword.sqlite-shm"), "stale-shm", "utf8");
      const result = runUpdater(harness);
      assert.notEqual(result.status, 0, result.stderr);
      assert.ok(readFileSync(harness.templatePath, "utf8").includes(`<Repository>${OLD_REF}</Repository>`));
      const state = readState(harness.stateDir);
      assert.equal(state.image, OLD_REF);
      assert.equal(state.health, "healthy");
      assert.equal(state.backup_count, "1");
      assert.equal(state.update_count, "2");
      assert.ok(Number(state.stop_count) >= 1);
      assert.equal(readFileSync(join(harness.dataDir, "coopword.sqlite"), "utf8"), "pre-update-db");
      assert.equal(existsSync(join(harness.dataDir, "coopword.sqlite-wal")), false);
      assert.equal(existsSync(join(harness.dataDir, "coopword.sqlite-shm")), false);
      assert.match(`${result.stdout}\n${result.stderr}`, /roll(ed)? back|unhealthy/i);
    } finally {
      cleanup(harness);
    }
  },
);

test(
  "updater fails closed before mutation when prerequisites are missing or inconsistent",
  { skip: skipReason },
  () => {
    const cases: Array<{
      name: string;
      options: Parameters<typeof createHarness>[0];
      expectTemplate?: string;
    }> = [
      { name: "missing template", options: { includeTemplate: false }, expectTemplate: OLD_REF },
      { name: "missing dockerMan script", options: { includeUpdateScript: false }, expectTemplate: OLD_REF },
      { name: "missing stable release", options: { releaseTag: null }, expectTemplate: OLD_REF },
      { name: "missing GHCR digest", options: { targetDigest: null }, expectTemplate: OLD_REF },
      { name: "missing anonymous GHCR token", options: { includeGhcrToken: false }, expectTemplate: OLD_REF },
      { name: "template/container name mismatch", options: { templateName: "other-container" }, expectTemplate: OLD_REF },
      {
        name: "template/running digest mismatch",
        options: { repository: OLD_REF, runningImage: NEW_REF, targetDigest: NEW_DIGEST },
        expectTemplate: OLD_REF,
      },
      { name: "missing /app/data mount", options: { includeDataMount: false }, expectTemplate: OLD_REF },
      { name: "missing database", options: { includeDatabase: false }, expectTemplate: OLD_REF },
      { name: "release tag is not URL-safe", options: { releaseTag: "release/v9.1.0" }, expectTemplate: OLD_REF },
    ];

    for (const testCase of cases) {
      const harness = createHarness({
        repository: OLD_REF,
        runningImage: OLD_REF,
        targetDigest: NEW_DIGEST,
        ...testCase.options,
      });
      try {
        const beforeDb = existsSync(join(harness.dataDir, "coopword.sqlite"))
          ? readFileSync(join(harness.dataDir, "coopword.sqlite"), "utf8")
          : null;
        const result = runUpdater(harness);
        assert.notEqual(result.status, 0, `${testCase.name}: ${result.stderr}`);
        const state = readState(harness.stateDir);
        assert.equal(state.update_count, "0", testCase.name);
        assert.equal(state.backup_count, "0", testCase.name);
        assert.equal(state.mutated, "0", testCase.name);
        if (testCase.options?.includeTemplate !== false) {
          assert.ok(
            readFileSync(harness.templatePath, "utf8").includes(
              `<Repository>${testCase.expectTemplate ?? OLD_REF}</Repository>`,
            ),
            testCase.name,
          );
        }
        if (beforeDb !== null) {
          assert.equal(readFileSync(join(harness.dataDir, "coopword.sqlite"), "utf8"), beforeDb, testCase.name);
        }
      } finally {
        cleanup(harness);
      }
    }
  },
);
test(
  "rejects invalid health timing before any deployment side effects",
  { skip: skipReason },
  () => {
    const cases = [
      ["COOPWORD_HEALTH_TIMEOUT_SEC", "invalid"],
      ["COOPWORD_HEALTH_TIMEOUT_SEC", "0"],
      ["COOPWORD_HEALTH_POLL_SEC", "invalid"],
      ["COOPWORD_HEALTH_POLL_SEC", "00"],
    ] as const;
    for (const [key, value] of cases) {
      const harness = createHarness();
      harness.env[key] = value;
      try {
        const beforeTemplate = readFileSync(harness.templatePath, "utf8");
        const result = runUpdater(harness);
        assert.notEqual(result.status, 0, `${key}=${value}: ${result.stderr}`);
        const state = readState(harness.stateDir);
        assert.equal(state.update_count, "0", `${key}=${value}`);
        assert.equal(state.backup_count, "0", `${key}=${value}`);
        assert.equal(state.mutated, "0", `${key}=${value}`);
        assert.equal(readFileSync(harness.templatePath, "utf8"), beforeTemplate, `${key}=${value}`);
      } finally {
        cleanup(harness);
      }
    }
  },
);
test(
  "rolls back after dockerMan removes the container and then fails",
  { skip: skipReason },
  () => {
    const harness = createHarness({ failUpdateAfterRemoval: true });
    try {
      writeFileSync(join(harness.dataDir, "coopword.sqlite"), "pre-update-db", "utf8");
      const result = runUpdater(harness);
      assert.notEqual(result.status, 0, result.stderr);
      assert.ok(readFileSync(harness.templatePath, "utf8").includes(`<Repository>${OLD_REF}</Repository>`));
      const state = readState(harness.stateDir);
      assert.equal(state.image, OLD_REF);
      assert.equal(state.container_exists, "1");
      assert.equal(state.health, "healthy");
      assert.equal(state.backup_count, "1");
      assert.equal(state.update_count, "2");
      assert.equal(state.stop_count, "0");
      assert.equal(readFileSync(join(harness.dataDir, "coopword.sqlite"), "utf8"), "pre-update-db");
      assert.match(`${result.stdout}\n${result.stderr}`, /rolled back/i);
    } finally {
      cleanup(harness);
    }
  },
);
