#!/usr/bin/env bash
# Brings up the portable Immich stack entirely from this drive: starts a
# static dockerd (no system install, no internet), loads the bundled images
# on first run only, brings up docker compose, waits for the server to be
# healthy, then opens a browser at it.
#
# Safe to re-run any time (after a reboot, after unplugging/replugging) --
# everything it does is idempotent.
#
# Everything this script prints (including from dockerd/docker/compose
# themselves) is captured to logs/start-<timestamp>.log on the drive, plus
# logs/latest-start.log always pointing at the most recent run — so after a
# crash/reboot/terminal-loss you still have a full transcript to read back,
# without needing to reproduce the problem live.
set -euo pipefail

DRIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$DRIVE/runtime/docker"
DATA_ROOT="$DRIVE/docker-data"
# dockerd's *runtime* state (as opposed to --data-root's persistent image/container
# data) defaults to a fixed system path (/run/docker) if not told otherwise. That's a
# problem for a portable setup: if a previous run on a different drive (or a previous
# attempt on this one) didn't shut down cleanly, its leftover containerd process/socket
# lives there and a fresh dockerd can find and try to reattach to it, hang, and time out
# — regardless of which drive/data-root the new run actually points at. Keeping this on
# the drive too, scoped per-drive, avoids that collision entirely.
EXEC_ROOT="$DRIVE/docker-exec"
DOCKER_CONFIG_DIR="$DRIVE/dockerconfig"
SOCK="$DATA_ROOT/docker.sock"
PIDFILE="$DATA_ROOT/dockerd.pid"
LOG_DIR="$DRIVE/logs"
# Deliberately NOT under $DATA_ROOT: dockerd locks that directory down to root-only
# once it's fully started, which would break plain-user log redirection on every run
# after the first.
DOCKERD_LOG="$LOG_DIR/dockerd.log"
LOADED_MARKER="$DATA_ROOT/.images-loaded"
COMPOSE_FILE="$DRIVE/docker-compose.portable.yml"
ENV_FILE="$DRIVE/.env.portable"

DOCKER_BIN="$DOCKER_DIR/docker"
DOCKERD_BIN="$DOCKER_DIR/dockerd"
COMPOSE_BIN="$DOCKER_DIR/docker-compose-linux-x86_64"

mkdir -p "$LOG_DIR"
RUN_LOG="$LOG_DIR/start-$(date +%Y%m%d-%H%M%S).log"
# Everything from here on — this script's own output AND every command it runs
# (docker load progress, compose up progress, etc.) — goes to both the terminal
# and $RUN_LOG.
exec > >(tee -a "$RUN_LOG") 2>&1
ln -sf "$(basename "$RUN_LOG")" "$LOG_DIR/latest-start.log" 2>/dev/null || cp "$RUN_LOG" "$LOG_DIR/latest-start.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] [start-immich] $*"; }
die() { echo "[$(ts)] [start-immich] ERROR: $*"; exit 1; }  # dump_state runs via the EXIT trap below regardless of how the script exits

# Runs on every exit, success or failure, so the log always ends with a clear
# picture of what state everything was actually left in — no need to ask for
# a follow-up docker ps/logs round trip after the fact.
dump_state() {
  set +e  # this runs during exit/cleanup — never let one failed diagnostic command cut the rest of the dump short
  local outcome="${1:-EXIT}"
  log "=== post-run state dump ($outcome) ==="
  log "free memory:"; free -h 2>&1 | sed 's/^/    /'
  log "swap:"; sudo swapon --show 2>&1 | sed 's/^/    /'
  log "disk space on drive:"; df -h "$DRIVE" 2>&1 | sed 's/^/    /'
  if sudo test -S "$SOCK" 2>/dev/null; then
    log "docker images:"; run_docker images 2>&1 | sed 's/^/    /'
    log "container status:"; run_docker ps -a 2>&1 | sed 's/^/    /'
    for c in immich_server immich_machine_learning immich_postgres immich_redis; do
      local status
      status="$(run_docker inspect -f '{{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$c" 2>&1)"
      log "  $c: $status"
      if ! echo "$status" | grep -qE '^running'; then
        log "  --- last 40 log lines from $c (not running, dumping for diagnosis) ---"
        run_docker logs --tail 40 "$c" 2>&1 | sed 's/^/    /'
      fi
    done
  else
    log "docker socket not reachable — dockerd is not up"
  fi
  log "=== end state dump. Full transcript: $RUN_LOG ==="
}
trap 'dump_state "EXIT (code $?)"' EXIT

log "=== start-immich.sh starting ==="
log "preflight: $(uname -a)"
log "preflight: $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME || echo 'no /etc/os-release')"
log "preflight: whoami=$(whoami) drive=$DRIVE"
log "preflight: free memory:"; free -h | sed 's/^/    /'
log "preflight: disk space on drive:"; df -h "$DRIVE" | sed 's/^/    /'
for bin in sudo wget iptables; do
  if command -v "$bin" >/dev/null 2>&1; then
    log "preflight: $bin found ($(command -v "$bin"))"
  else
    log "preflight: WARNING $bin NOT found"
  fi
done
log "preflight: kernel modules: $(lsmod 2>/dev/null | grep -E '^overlay|^br_netfilter' | awk '{print $1}' | tr '\n' ' ' || echo 'lsmod unavailable')"

[ -f "$DOCKERD_BIN" ] || die "static dockerd binary not found at $DOCKERD_BIN — is this script running from the drive's own copy of the bundle?"
# Copies from Windows/NTFS routinely lose the executable bit — restore it defensively
# rather than assume whatever copied this bundle onto the drive preserved it.
chmod +x "$DOCKER_DIR"/* "$DRIVE/start-immich.sh" "$DRIVE/stop-immich.sh" "$DRIVE/cleanup.sh" 2>/dev/null || true
command -v sudo >/dev/null || die "sudo not found — this needs to run in a session with root access (e.g. the live Ubuntu user account)."

run_docker() {
  sudo env "DOCKER_HOST=unix://$SOCK" "DOCKER_CONFIG=$DOCKER_CONFIG_DIR" "$DOCKER_BIN" "$@"
}
run_compose() {
  sudo env "DOCKER_HOST=unix://$SOCK" "DOCKER_CONFIG=$DOCKER_CONFIG_DIR" \
    "$COMPOSE_BIN" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --project-directory "$DRIVE" "$@"
}

# No interactive "clean up existing state?" prompt here on purpose — it used to ask
# every single run whenever docker-data/docker-exec existed but dockerd wasn't
# currently live (i.e. after every reboot, which is the common case, not just
# failures). If you actually want a clean slate — after a failed/interrupted setup,
# or to force a fresh image reload after copying updated images/*.tar over for an
# upgrade — run ./cleanup.sh yourself first, then run this script. Otherwise this
# always just reuses whatever's already on the drive, same as always.

mkdir -p "$DATA_ROOT" "$DOCKER_CONFIG_DIR" "$LOG_DIR" \
         "$DRIVE/library/photos" "$DRIVE/library/postgres" "$DRIVE/library/model-cache"

# --- disk space preflight ---
# Only matters on first run: images haven't been extracted into docker-data yet, and/or
# the model cache hasn't been copied into library/ yet. Both are one-time space spikes.
# Docker image tars expand roughly 4-5x once unpacked as layers (measured on this bundle:
# ~1.4G of tars -> ~6.1G extracted) — a drive that "looks" like it has enough free space
# for the tars themselves can still run out of room mid-extraction, which corrupts
# docker-data and wastes a lot of time before failing. Check up front instead.
NEED_LOAD=1; sudo test -f "$LOADED_MARKER" && NEED_LOAD=0
# Seeding works per model, not all-or-nothing: an install that was seeded before a model was added to
# the bundle (e.g. the Whisper models for subtitles) gets the new one on its next start, without
# re-copying the rest. This machine is offline, so a model that isn't seeded can never be fetched.
#
# A model counts as present only when every one of its seed files is there at the same size. Checking the
# folder alone isn't enough: the ML service creates a model's folder before it tries to download, so a
# failed offline attempt (OCR does this) leaves an empty folder that would otherwise block seeding forever.
# sudo: the ML container writes the cache as root.
missing_seed_models() {
  local model_dir rel seed_file want have
  for model_dir in "$DRIVE"/model-cache-seed/*/*/; do
    [ -d "$model_dir" ] || continue
    model_dir="${model_dir%/}"
    rel="${model_dir#"$DRIVE"/model-cache-seed/}"
    while IFS= read -r -d '' seed_file; do
      want=$(stat -c %s "$seed_file")
      have=$(sudo stat -c %s "$DRIVE/library/model-cache/$rel/${seed_file#"$model_dir"/}" 2>/dev/null || echo missing)
      if [ "$have" != "$want" ]; then
        printf '%s\n' "$rel"
        break
      fi
    done < <(find "$model_dir" -type f -print0)
  done
}
NEEDED_BYTES=0
if [ "$NEED_LOAD" -eq 1 ]; then
  tar_bytes=$(du -sbc "$DRIVE"/images/*.tar 2>/dev/null | tail -1 | awk '{print $1+0}')
  NEEDED_BYTES=$(( NEEDED_BYTES + tar_bytes * 9 / 2 ))  # ~4.5x expansion, matches measured ratios
fi
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  seed_bytes=$(du -sb "$DRIVE/model-cache-seed/$rel" 2>/dev/null | awk '{print $1+0}')
  NEEDED_BYTES=$(( NEEDED_BYTES + seed_bytes ))
done < <(missing_seed_models)
SAFETY_BUFFER_BYTES=$((1 * 1024 * 1024 * 1024))  # 1G headroom for Postgres init, logs, etc.
NEEDED_BYTES=$(( NEEDED_BYTES + SAFETY_BUFFER_BYTES ))
AVAIL_BYTES=$(df -B1 --output=avail "$DRIVE" 2>/dev/null | tail -1 | tr -d ' ')
AVAIL_BYTES=${AVAIL_BYTES:-0}
log "disk space check: need ~$(( NEEDED_BYTES / 1024 / 1024 / 1024 ))G more (first-run extraction/seeding), have $(( AVAIL_BYTES / 1024 / 1024 / 1024 ))G free"
if [ "$NEEDED_BYTES" -gt "$AVAIL_BYTES" ]; then
  die "not enough free space on this drive: need roughly $(( NEEDED_BYTES / 1024 / 1024 / 1024 ))G free for first-run image extraction/model-cache seeding, only $(( AVAIL_BYTES / 1024 / 1024 / 1024 ))G available. This bundle's Docker images alone need ~6G once unpacked, regardless of swap — a bigger drive is needed, not a config fix."
fi

# --- swap ---
# Live boots have no swap by default, and the ML container's models + Postgres +
# dockerd's own overhead can add up to more than a memory-constrained laptop has —
# an OOM kill of dockerd (or the terminal itself) looks exactly like "everything just
# vanished". A swapfile on the drive gives real headroom instead of hoping RAM is enough.
# But it must not eat space the image extraction above actually needs — only create it
# if there's comfortable headroom left over after that.
SWAPFILE="$DRIVE/swapfile"
SWAP_SIZE_BYTES=$((4 * 1024 * 1024 * 1024))
if sudo swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAPFILE"; then
  log "swap already active ($SWAPFILE)"
elif [ -f "$SWAPFILE" ]; then
  # Already created on a previous run (and its bytes are already counted in AVAIL_BYTES
  # since they're allocated on disk either way) — just turn it back on.
  if sudo swapon "$SWAPFILE"; then
    log "swap enabled ($SWAPFILE)"
  else
    log "WARNING: could not enable existing swapfile — continuing without it."
  fi
elif [ "$AVAIL_BYTES" -gt "$(( NEEDED_BYTES + SWAP_SIZE_BYTES + SAFETY_BUFFER_BYTES ))" ]; then
  log "creating a 4G swapfile on the drive (one-time; reused on later runs)"
  sudo fallocate -l 4G "$SWAPFILE" 2>/dev/null || sudo dd if=/dev/zero of="$SWAPFILE" bs=1M count=4096 status=none
  sudo chmod 600 "$SWAPFILE"
  sudo mkswap "$SWAPFILE" >/dev/null
  if sudo swapon "$SWAPFILE"; then
    log "swap enabled ($SWAPFILE)"
  else
    log "WARNING: could not enable swap — continuing without it. If the stack gets OOM-killed, this is likely why."
  fi
else
  log "skipping swap: not enough spare space on this drive ($(( AVAIL_BYTES / 1024 / 1024 / 1024 ))G free) to spare 4G for it without risking the same 'no space left on device' failure. If the stack gets OOM-killed, this is likely why — a bigger drive fixes both problems at once."
fi
log "memory after swap setup:"; free -h | sed 's/^/    /'

# --- start dockerd (from the bundled static binary, not any system install) ---
if sudo test -S "$SOCK" && run_docker info >/dev/null 2>&1; then
  log "dockerd already running on $SOCK"
else
  log "starting dockerd (data-root: $DATA_ROOT, exec-root: $EXEC_ROOT), logging to $DOCKERD_LOG"
  sudo rm -f "$SOCK" "$PIDFILE"
  # Wipe exec-root before every fresh start — it's runtime state (sockets, mount
  # namespaces, a leftover containerd pid) that should never carry over from a
  # previous, possibly-uncleanly-ended run. Any actual running containerd found here
  # is necessarily stale, since we already confirmed above that our own socket isn't
  # live — reattaching to it is exactly what caused the hang this was added to fix.
  # containerd-shim processes are deliberately designed to survive their daemon dying
  # (that's what lets `systemctl restart docker` not kill your containers) — so a crashed
  # dockerd can leave the actual container processes (Postgres, Valkey, the ML server...)
  # running as orphans, still holding their old cgroups. A fresh container start into
  # those same cgroups then fails with "cgroup is not empty". Kill the whole leftover
  # process tree — shim, and whatever it was managing underneath — for anything
  # referencing our own exec-root path, which only ever appears in OUR own
  # containerd/shim command lines (NOT via fuser -m: that resolves to the *entire*
  # containing filesystem, not just this subdirectory, and will kill this very script).
  kill_tree() {
    local pid="$1" c
    for c in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$c"; done
    sudo kill -9 "$pid" 2>/dev/null || true
  }
  for p in $(pgrep -f "containerd.*$EXEC_ROOT" 2>/dev/null); do kill_tree "$p"; done
  sleep 1
  # A crashed dockerd leaves each container's network-namespace bind mount behind under
  # exec-root/netns/ — those show as "Device or resource busy" to a plain rm -rf, which
  # (with set -e) would otherwise abort the script before dockerd ever got a chance to
  # start. Lazy-unmount anything still mounted under exec-root first.
  for m in $(mount 2>/dev/null | awk -v er="$EXEC_ROOT" '$3 == er || index($3, er "/") == 1 {print $3}' | sort -r); do
    sudo umount -l "$m" 2>/dev/null || true
  done
  sudo rm -rf "$EXEC_ROOT" || log "WARNING: could not fully clear $EXEC_ROOT — proceeding anyway, dockerd may still start fine with leftovers present"
  sudo mkdir -p "$EXEC_ROOT"
  # dockerd looks up containerd/containerd-shim-runc-v2/runc on PATH to spawn them —
  # sudo resets PATH by default, so without this it can't find its own bundled containerd.
  #
  # setsid fully detaches dockerd into its own session, so it survives even if the
  # terminal window/app that launched this script crashes or closes outright — `disown`
  # alone only stops the *shell* from SIGHUPing it on a clean exit; it does nothing if
  # the controlling terminal's pty itself goes away, which sends SIGHUP directly from
  # the kernel.
  sudo setsid env "PATH=$DOCKER_DIR:$PATH" "$DOCKERD_BIN" \
    --data-root="$DATA_ROOT" \
    --exec-root="$EXEC_ROOT" \
    --host="unix://$SOCK" \
    --pidfile="$PIDFILE" \
    --userland-proxy-path="$DOCKER_DIR/docker-proxy" \
    </dev/null >>"$DOCKERD_LOG" 2>&1 &
  disown

  log "waiting for dockerd to come up..."
  dockerd_up=0
  for i in $(seq 1 60); do
    if sudo test -S "$SOCK" && run_docker info >/dev/null 2>&1; then
      dockerd_up=1
      break
    fi
    if [ $((i % 10)) -eq 0 ]; then
      log "  still waiting (${i}s)... last dockerd.log lines:"
      sudo tail -5 "$DOCKERD_LOG" 2>&1 | sed 's/^/    /'
    fi
    sleep 1
  done
  [ "$dockerd_up" -eq 1 ] || die "dockerd did not come up in 60s — full dockerd.log follows:
$(sudo cat "$DOCKERD_LOG" 2>&1)
(common cause: missing iptables/overlay kernel support on this live image, see README troubleshooting)"
  log "dockerd is up"
  log "docker info summary:"; run_docker info 2>&1 | grep -E 'Storage Driver|Cgroup Driver|Server Version|Kernel Version' | sed 's/^/    /'
fi

# --- first-run only: load images, seed the ML model cache ---
# $DATA_ROOT is root-owned (dockerd created it via sudo), so the marker check/write go through sudo too.
if sudo test -f "$LOADED_MARKER"; then
  log "images already loaded into $DATA_ROOT (first run was on $(sudo cat "$LOADED_MARKER")) — skipping docker load"
else
  log "first run: loading bundled images (this only happens once per drive)"
  for tar in "$DRIVE"/images/*.tar; do
    name="$(basename "$tar")"
    log "  docker load < $name ($(du -h "$tar" | cut -f1))"
    load_output="$(run_docker load -i "$tar")" || die "docker load failed for $name"
    echo "$load_output"
    log "  ok: $name loaded"
    # docker save/load doesn't round-trip a compound "repo:tag@digest" reference (what
    # postgres.tar/valkey.tar are pinned by in docker-compose.portable.yml) — it comes
    # back completely untagged, only reachable by image ID, which isn't even what
    # "Loaded image: <ref>" reports for these two (it reports "Loaded image ID: sha256:.."
    # instead, confirming there's no name at all). Without a matching tag, compose
    # decides the image is "missing" and tries to pull it over a network that doesn't
    # exist here — which can also strip any tag off the image in the process. Capture
    # the actual loaded image ID and re-tag it to match exactly what compose expects, so
    # it resolves locally and never touches the network. (immich-server/immich-machine-
    # learning don't need this: compose references them by plain tag only, which docker
    # load preserves correctly on its own.)
    # ML/server load with a named tag, not a bare ID — grep correctly finds nothing for
    # them, which (with pipefail + set -e) would otherwise kill the whole script here.
    image_id="$(echo "$load_output" | grep -oE 'sha256:[0-9a-f]+' | head -1)" || true
    case "$name" in
      postgres.tar)
        [ -n "$image_id" ] || die "postgres.tar loaded but no image ID could be parsed from: $load_output"
        log "  re-tagging $image_id -> ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0"
        run_docker tag "$image_id" "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0" \
          || die "could not re-tag loaded postgres image $image_id"
        ;;
      valkey.tar)
        [ -n "$image_id" ] || die "valkey.tar loaded but no image ID could be parsed from: $load_output"
        log "  re-tagging $image_id -> docker.io/valkey/valkey:9"
        run_docker tag "$image_id" "docker.io/valkey/valkey:9" \
          || die "could not re-tag loaded valkey image $image_id"
        ;;
    esac
  done
  log "all images loaded:"; run_docker images 2>&1 | sed 's/^/    /'
  date | sudo tee "$LOADED_MARKER" >/dev/null
fi

MISSING_MODELS="$(missing_seed_models)"
if [ -z "$MISSING_MODELS" ]; then
  log "model cache already has every bundled model ($(du -sh "$DRIVE/library/model-cache" 2>/dev/null | cut -f1))"
else
  log "seeding ML model cache from model-cache-seed/ (this machine is offline, so models can't be downloaded)"
  while IFS= read -r rel; do
    log "  seeding $rel ($(du -sh "$DRIVE/model-cache-seed/$rel" 2>/dev/null | cut -f1))"
    # sudo: the ML container runs as root and may already have created the task directory itself.
    sudo mkdir -p "$DRIVE/library/model-cache/$(dirname "$rel")"
    sudo cp -a "$DRIVE/model-cache-seed/$rel" "$DRIVE/library/model-cache/$(dirname "$rel")/" \
      || die "failed to seed model $rel into library/model-cache"
  done <<< "$MISSING_MODELS"
  log "  seeded ($(du -sh "$DRIVE/library/model-cache" 2>/dev/null | cut -f1))"
fi

# --- bring up the stack ---
log "starting docker compose stack"
run_compose up -d || die "docker compose up failed"

log "container status right after compose up:"
run_docker ps -a 2>&1 | sed 's/^/    /'

log "waiting for immich-server to become healthy..."
server_up=0
for i in $(seq 1 180); do
  # curl is NOT present on the live image (confirmed) — wget is, use that instead.
  if wget -q -O /dev/null "http://localhost:2283/api/server/ping"; then
    server_up=1
    break
  fi
  if [ $((i % 15)) -eq 0 ]; then
    log "  still waiting (${i}0s)... container status:"
    run_docker ps -a 2>&1 | sed 's/^/    /'
  fi
  sleep 2
done
if [ "$server_up" -ne 1 ]; then
  die "immich-server did not become healthy in 6 minutes — check the container status/logs above, or:
  sudo env DOCKER_HOST=unix://$SOCK $DOCKER_BIN logs immich_server"
fi
log "immich-server is up"

# --- open a browser ---
URL="http://localhost:2283"
log "opening $URL"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
elif command -v firefox >/dev/null 2>&1; then
  firefox "$URL" >/dev/null 2>&1 &
else
  log "no browser launcher found — open $URL manually"
fi

log "done. Run ./stop-immich.sh before unplugging this drive."
log "full transcript of this run: $RUN_LOG (also: $LOG_DIR/latest-start.log)"
