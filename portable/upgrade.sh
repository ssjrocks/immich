#!/usr/bin/env bash
# Applies updated image tar(s) that have already been copied into images/
# (overwriting the old ones) — forces dockerd to forget its currently-loaded
# images and reload fresh, WITHOUT touching your photo library or Postgres
# database (those live in library/, entirely separate from docker-data/).
#
# Usage: copy the new tar(s) into images/, replacing whichever ones changed,
# then run:
#   ./upgrade.sh
#
# This is just stop-immich.sh + cleanup.sh + start-immich.sh run back to back,
# packaged as one step so upgrading doesn't require remembering that sequence.
set -uo pipefail

DRIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$DRIVE/logs"

mkdir -p "$LOG_DIR"
RUN_LOG="$LOG_DIR/upgrade-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$RUN_LOG") 2>&1
ln -sf "$(basename "$RUN_LOG")" "$LOG_DIR/latest-upgrade.log" 2>/dev/null || cp "$RUN_LOG" "$LOG_DIR/latest-upgrade.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] [upgrade] $*"; }
trap 'log "=== upgrade.sh exiting (code $?). Full transcript: $RUN_LOG ==="' EXIT

log "=== upgrade.sh starting ==="
log "images currently staged in images/:"
ls -la "$DRIVE/images/" | sed 's/^/    /'

chmod +x "$DRIVE"/*.sh 2>/dev/null || true

log "--- stopping the running stack (if any) ---"
bash "$DRIVE/stop-immich.sh"

log "--- clearing Docker Engine state so the new image tars get loaded fresh (library/ untouched) ---"
bash "$DRIVE/cleanup.sh"

log "--- starting back up with the new images ---"
bash "$DRIVE/start-immich.sh"

log "done. If start-immich.sh reported success above, the upgrade is live and your existing library/database were untouched throughout."
