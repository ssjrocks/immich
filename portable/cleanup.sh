#!/usr/bin/env bash
# Fully tears down this drive's Docker Engine state: kills any dockerd/containerd
# still running for it, disables and removes the swapfile, and removes
# docker-data/docker-exec/dockerconfig — all root-owned once dockerd touches them,
# which is exactly why a plain `rm -rf` on the whole bundle folder fails with
# "Operation not permitted" otherwise.
#
# Does NOT touch library/ (your photos, Postgres data, ML model cache), logs/, or
# model-cache-seed/ — only resets container-engine-level state, so a completely
# broken setup can be recovered by re-running start-immich.sh afterward without
# losing anything real.
#
# Safe to run standalone any time. start-immich.sh also calls this automatically
# if you answer yes to its "clean up existing state?" prompt.
set -uo pipefail

DRIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_ROOT="$DRIVE/docker-data"
EXEC_ROOT="$DRIVE/docker-exec"
DOCKER_CONFIG_DIR="$DRIVE/dockerconfig"
SWAPFILE="$DRIVE/swapfile"
LOG_DIR="$DRIVE/logs"

mkdir -p "$LOG_DIR"
RUN_LOG="$LOG_DIR/cleanup-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$RUN_LOG") 2>&1
ln -sf "$(basename "$RUN_LOG")" "$LOG_DIR/latest-cleanup.log" 2>/dev/null || cp "$RUN_LOG" "$LOG_DIR/latest-cleanup.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] [cleanup] $*"; }

log "=== cleanup.sh starting — resetting Docker Engine state on this drive ==="
log "(NOT touching library/, logs/, or model-cache-seed/ — only docker-data, docker-exec, dockerconfig, swapfile)"

# Recursively kill a process and all its descendants — needed because
# containerd-shim processes (and whatever they were managing underneath, like
# Postgres or Valkey) are deliberately designed to survive their daemon dying.
kill_tree() {
  local pid="$1" c
  for c in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$c"; done
  sudo kill -9 "$pid" 2>/dev/null || true
}

log "killing any dockerd/containerd (and whatever they were managing) for this drive"
for p in $(pgrep -f "dockerd.*--data-root=$DATA_ROOT" 2>/dev/null); do kill_tree "$p"; done
for p in $(pgrep -f "containerd.*$EXEC_ROOT" 2>/dev/null); do kill_tree "$p"; done
sleep 1

log "unmounting anything left under docker-data or docker-exec"
for m in $(mount 2>/dev/null | awk -v er="$EXEC_ROOT" -v dr="$DATA_ROOT" \
  '$3==er || index($3, er"/")==1 || $3==dr || index($3, dr"/")==1 {print $3}' | sort -r); do
  sudo umount -l "$m" 2>/dev/null || true
done

if sudo swapon --show=NAME --noheadings 2>/dev/null | grep -qx "$SWAPFILE"; then
  log "disabling swap on $SWAPFILE"
  sudo swapoff "$SWAPFILE" || log "WARNING: swapoff failed — it may still be in use; removal below may fail too"
fi

log "removing docker-data, docker-exec, dockerconfig, swapfile"
sudo rm -rf "$DATA_ROOT" "$EXEC_ROOT" "$DOCKER_CONFIG_DIR" "$SWAPFILE"

log "verifying:"
all_clear=1
for p in "$DATA_ROOT" "$EXEC_ROOT" "$DOCKER_CONFIG_DIR" "$SWAPFILE"; do
  if [ -e "$p" ]; then
    log "  STILL PRESENT: $p — check 'sudo fuser -vm $p' for what's still using it"
    all_clear=0
  else
    log "  removed: $p"
  fi
done

if [ "$all_clear" -eq 1 ]; then
  log "done — fully clean. Run ./start-immich.sh to start fresh."
else
  log "done — some items could not be removed (see above). Full transcript: $RUN_LOG"
fi
