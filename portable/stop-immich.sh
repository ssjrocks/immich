#!/usr/bin/env bash
# Clean shutdown: stops the compose stack, then stops dockerd. Run this
# before unplugging the drive so Postgres isn't yanked mid-write.
#
# Logs everything to logs/stop-<timestamp>.log on the drive (and
# logs/latest-stop.log), same as start-immich.sh.
set -euo pipefail

DRIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$DRIVE/runtime/docker"
DATA_ROOT="$DRIVE/docker-data"
EXEC_ROOT="$DRIVE/docker-exec"
DOCKER_CONFIG_DIR="$DRIVE/dockerconfig"
SOCK="$DATA_ROOT/docker.sock"
PIDFILE="$DATA_ROOT/dockerd.pid"
LOG_DIR="$DRIVE/logs"
COMPOSE_FILE="$DRIVE/docker-compose.portable.yml"
ENV_FILE="$DRIVE/.env.portable"

DOCKER_BIN="$DOCKER_DIR/docker"
COMPOSE_BIN="$DOCKER_DIR/docker-compose-linux-x86_64"

mkdir -p "$LOG_DIR"
RUN_LOG="$LOG_DIR/stop-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$RUN_LOG") 2>&1
ln -sf "$(basename "$RUN_LOG")" "$LOG_DIR/latest-stop.log" 2>/dev/null || cp "$RUN_LOG" "$LOG_DIR/latest-stop.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] [stop-immich] $*"; }
trap 'log "=== stop-immich.sh exiting (code $?). Full transcript: $RUN_LOG ==="' EXIT

log "=== stop-immich.sh starting ==="

if sudo test -S "$SOCK"; then
  log "stopping compose stack"
  sudo env "DOCKER_HOST=unix://$SOCK" "DOCKER_CONFIG=$DOCKER_CONFIG_DIR" \
    "$COMPOSE_BIN" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --project-directory "$DRIVE" \
    down || log "compose down reported an error, continuing"
  log "container status after compose down:"
  sudo env "DOCKER_HOST=unix://$SOCK" "DOCKER_CONFIG=$DOCKER_CONFIG_DIR" "$DOCKER_BIN" ps -a 2>&1 | sed 's/^/    /'
else
  log "no docker socket at $SOCK — stack was not running"
fi

if sudo test -s "$PIDFILE"; then
  PID="$(sudo cat "$PIDFILE")"
  log "stopping dockerd (pid $PID)"
  sudo kill "$PID" 2>/dev/null || true
  stopped=0
  for i in $(seq 1 30); do
    if ! sudo kill -0 "$PID" 2>/dev/null; then
      stopped=1
      break
    fi
    sleep 1
  done
  if [ "$stopped" -eq 1 ]; then
    log "dockerd (pid $PID) stopped"
  else
    log "WARNING: dockerd (pid $PID) did not stop within 30s — sending SIGKILL"
    sudo kill -9 "$PID" 2>/dev/null || true
  fi
  sudo rm -f "$PIDFILE" "$SOCK"
  log "clearing exec-root ($EXEC_ROOT) so it can't confuse a future run on this or another drive"
  sudo rm -rf "$EXEC_ROOT"
else
  log "no dockerd pidfile found — nothing to stop"
fi

SWAPFILE="$DRIVE/swapfile"
if sudo swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAPFILE"; then
  log "disabling swap on $SWAPFILE"
  if sudo swapoff "$SWAPFILE"; then
    log "swap disabled"
  else
    log "WARNING: swapoff failed — do not unplug the drive until this is resolved, an active swapfile on it can crash the kernel if yanked"
  fi
fi

log "final process check:"; (pgrep -af 'runtime/docker/dockerd' || echo "    none running (correct)") | sed 's/^/    /'
log "done. Safe to unplug the drive now."
