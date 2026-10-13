#!/usr/bin/env bash
# immich-diag.sh — collects everything needed to diagnose the portable Immich bundle
# into one log file. Read-only, apart from a small disk write test (a 128MB temp file
# on the drive, deleted again straight after).
#
# Usage:   sudo bash immich-diag.sh [bundle-dir]
#          sudo bash immich-diag.sh [bundle-dir] --with-dockerd-test
# bundle-dir defaults to the folder this script is in (normally the bundle itself)
#
# --with-dockerd-test additionally starts the bundled dockerd in the foreground for
# 30s with --debug and records its output, then stops it. Only does so if no dockerd
# or containerd is already running.
#
# Every command has a time limit. If one hangs (e.g. stuck on a failing drive), it is
# abandoned, marked TIMED OUT, and the script carries on — that itself is evidence.
# The log is written to /tmp first (RAM, so it works even if the drive is the problem),
# then copied to the bundle's logs/ folder and next to this script.

if [ "$(id -u)" -ne 0 ]; then
  exec sudo bash "$0" "$@"
fi

B="$(cd "$(dirname "$0")" && pwd)"
DOCKERD_TEST=0
for a in "$@"; do
  case "$a" in
    --with-dockerd-test) DOCKERD_TEST=1 ;;
    *) B="${a%/}" ;;
  esac
done
export B
if [ ! -f "$B/start-immich.sh" ]; then
  echo "$B doesn't look like the portable Immich folder (no start-immich.sh there)."
  echo "Run this from inside that folder, or pass its path: sudo bash immich-diag.sh /path/to/immich-portable"
  exit 2
fi

TS="$(date +%Y%m%d-%H%M%S)"
LOG="/tmp/immich-diag-$TS.log"
TMPD="$(mktemp -d /tmp/immich-diag-work.XXXXXX)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec > >(tee -a "$LOG") 2>&1

section() { printf '\n\n######## %s ########\n' "$*"; }

# run TITLE TIMEOUT_SECONDS 'shell command'
# Runs the command in its own process group, caps its output, records exit code and
# how long it took. A command that outlives its timeout is killed and, if it won't die
# (stuck in the kernel), left behind and reported.
ms() { echo $(( $(date +%s%N) / 1000000 )); }
run() {
  local title="$1" limit="$2" cmd="$3" out pid start rc size
  out="$TMPD/out.$RANDOM"
  printf '\n----- %s\n$ %s\n' "$title" "$cmd"
  start=$(ms)
  setsid bash -c "$cmd" >"$out" 2>&1 </dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ $(( $(ms) - start )) -gt $(( limit * 1000 )) ]; then
      kill -TERM -- -"$pid" 2>/dev/null; sleep 1; kill -KILL -- -"$pid" 2>/dev/null; sleep 1
      head -c 20000 "$out"
      if kill -0 "$pid" 2>/dev/null; then
        printf '\n!!! TIMED OUT after %ss and could NOT be killed (pid %s, state %s) - stuck in the kernel, likely disk I/O\n' \
          "$limit" "$pid" "$(ps -o stat= -p "$pid" 2>/dev/null)"
      else
        printf '\n!!! TIMED OUT after %ss - killed\n' "$limit"
      fi
      return
    fi
    sleep 0.2
  done
  wait "$pid"; rc=$?
  size=$(stat -c %s "$out")
  head -c 40000 "$out"
  [ "$size" -gt 40000 ] && printf '\n... [output truncated, %s bytes total]\n' "$size"
  printf '[exit %s, %d.%01ds]\n' "$rc" $(( ($(ms) - start) / 1000 )) $(( ($(ms) - start) % 1000 / 100 ))
}

section "0. ABOUT THIS RUN"
echo "date:        $(date)"
echo "bundle dir:  $B"
echo "log:         $LOG"
echo "dockerd test requested: $DOCKERD_TEST"

section "1. SYSTEM, BOOT AND SHUTDOWN HISTORY"
run "uptime / boot time" 5 'uptime; echo; uptime -s; who -b'
run "kernel / os" 5 'uname -a; grep PRETTY /etc/os-release; cat /proc/cmdline'
run "boots known to the journal" 10 'journalctl --list-boots --no-pager | tail -5'
run "reboot/shutdown records" 5 'last -x -F 2>/dev/null | head -20'
run "scheduled shutdown pending?" 5 'cat /run/systemd/shutdown/scheduled 2>/dev/null || echo "none scheduled"'
run "systemd state and queued jobs (a stuck shutdown job shows here)" 10 'systemctl is-system-running; systemctl list-jobs --no-pager'
run "failed units" 10 'systemctl --failed --no-pager'
run "sudo version (sudo-rs vs sudo)" 5 'sudo --version | head -2'
run "time zone" 5 'timedatectl 2>/dev/null | head -6 || date'

section "2. MEMORY, CPU, PRESSURE"
run "free" 5 'free -h'
run "swap" 5 'swapon --show'
run "pressure stall info (how much time things wait on cpu/memory/io)" 5 'for f in cpu memory io; do echo "== $f"; cat /proc/pressure/$f; done'
run "vmstat 1s x 5 (watch b=blocked, wa=io wait, si/so=swapping)" 15 'vmstat -w 1 5'
run "load and tmpfs usage (live session root lives in RAM)" 5 'cat /proc/loadavg; echo; df -h -t tmpfs -t overlay 2>/dev/null'
run "meminfo" 5 'grep -E "MemTotal|MemAvailable|Dirty|Writeback|Shmem:|SwapTotal|SwapFree|Committed_AS" /proc/meminfo'
run "top 25 by memory" 5 'ps -eo pid,ppid,stat,etime,rss,pcpu,args --sort=-rss | cut -c1-220 | head -26'
run "top 25 by cpu" 5 'ps -eo pid,ppid,stat,etime,rss,pcpu,args --sort=-pcpu | cut -c1-220 | head -26'
run "temperatures" 5 'sensors 2>/dev/null || for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type) $(( $(cat $z/temp) / 1000 ))C"; done'

section "3. STUCK PROCESSES"
run "processes in D (stuck on I/O), T (stopped) or Z (zombie) state" 10 \
  'ps -eo pid,ppid,stat,etime,wchan:32,args | awk "NR==1 || \$3 ~ /^[DTZ]/" | cut -c1-250'
run "kernel stacks of D-state processes" 15 \
  'for p in $(ps -eo pid=,stat= | awk "\$2 ~ /^D/ {print \$1}"); do echo "== pid $p: $(tr "\0" " " < /proc/$p/cmdline | cut -c1-200)"; cat /proc/$p/stack 2>/dev/null; done; echo done'
run "anything immich/docker related still running (incl. old start/stop scripts)" 10 \
  'ps -eo pid,ppid,stat,etime,wchan:24,args | grep -E "immich|dockerd|containerd|runc|docker-proxy|docker |compose|postgres|valkey|redis|nginx|python|node|setsid|shutdown" | grep -v -E "grep|immich-diag" | cut -c1-250'
run "process tree" 10 'pstree -apl 2>/dev/null | grep -B2 -A6 -E "dockerd|containerd|immich" | head -120'

section "4. KERNEL LOG"
run "kernel errors and warnings" 15 'dmesg -T --level=emerg,alert,crit,err,warn | tail -150'
run "kernel: disk / usb / filesystem / hang / oom keywords" 15 \
  'dmesg -T | grep -iE "i/o error|blk_update|buffer i/o|reset|usb|uas|scsi|sd[a-z]|ext4|dm-|crypt|hung_task|blocked for more|oom|killed process|segfault|overlay|br_netfilter|bridge|veth|docker|nf_tables|iptables" | tail -250'
run "kernel: last 80 lines" 10 'dmesg -T | tail -80'

section "5. JOURNAL (since yesterday evening)"
run "warnings+ since yesterday 18:00" 30 'journalctl --no-pager -p warning --since "yesterday 18:00" | tail -250'
run "docker/immich/shutdown/oom related since yesterday 18:00" 30 \
  'journalctl --no-pager --since "yesterday 18:00" | grep -iE "docker|containerd|immich|shutdown|power|logind|oom|swap|hung|blocked|usb|udisks|luks|crypt|ext4" | tail -250'

section "6. THE DRIVE"
run "block devices" 10 'lsblk -o NAME,SIZE,TYPE,FSTYPE,TRAN,MODEL,STATE,RO,MOUNTPOINTS'
run "mount of bundle dir (look for noexec/ro/errors)" 10 'findmnt -T "$B" -o TARGET,SOURCE,FSTYPE,OPTIONS'
run "free space and inodes" 10 'df -h "$B"; df -i "$B"'
run "luks mapping" 10 'dev=$(findmnt -n -o SOURCE -T "$B"); echo "$dev"; cryptsetup status "$dev" 2>&1; dmsetup info "$dev" 2>&1 | head -12'
run "ext4 health (error count, last error, state)" 15 \
  'dev=$(findmnt -n -o SOURCE -T "$B"); dumpe2fs -h "$dev" 2>/dev/null | grep -iE "state|error|mount count|last (mount|write|check)|lifetime|features"'
run "underlying disk SMART (if smartctl exists)" 30 \
  'dev=$(findmnt -n -o SOURCE -T "$B"); parent=$(lsblk -no PKNAME "$dev" | tail -1); while [ -n "$parent" ]; do top=$parent; parent=$(lsblk -no PKNAME /dev/$top | head -1); done; echo "physical disk: /dev/$top"; command -v smartctl >/dev/null && (smartctl -a /dev/$top || smartctl -a -d sat /dev/$top) || echo "smartctl not installed"'
run "disk I/O counters" 5 'cat /proc/diskstats | awk "\$4+\$8 > 0"'
run "READ speed: 512MB direct read from the map archive" 120 \
  'f="$B/map-tiles/serve/planet-z10.pmtiles"; [ -f "$f" ] || f=$(ls -S "$B"/images/*.tar | head -1); dd if="$f" of=/dev/null bs=4M count=128 skip=400 iflag=direct 2>&1 | tail -1'
run "WRITE speed: 128MB direct write + fsync, then deleted" 120 \
  't="$B/.diag-writetest"; dd if=/dev/zero of="$t" bs=4M count=32 oflag=direct conv=fsync 2>&1 | tail -1; rm -f "$t"'

section "7. BUNDLE STATE ON THE DRIVE"
run "bundle top level" 15 'ls -la "$B"'
run "logs folder" 15 'ls -la --time-style=full-iso "$B/logs" | tail -40'
run "docker-data top level, image marker, pidfile, socket" 15 \
  'ls -la "$B/docker-data" 2>&1 | head -30; echo; echo "marker: $(cat "$B/docker-data/.images-loaded" 2>&1)"; echo "pidfile: $(cat "$B/docker-data/dockerd.pid" 2>&1)"; p=$(cat "$B/docker-data/dockerd.pid" 2>/dev/null); [ -n "$p" ] && { echo "pid $p alive?"; ps -o pid,stat,etime,args -p "$p" || echo "not running (stale pidfile)"; }; ls -la "$B/docker-data/docker.sock" 2>&1'
run "docker-data subfolder sizes (quick)" 60 'du -sh "$B"/docker-data/* 2>/dev/null'
run "docker-exec leftovers" 15 'find "$B/docker-exec" -maxdepth 3 2>&1 | head -60'
run "mounts still active under docker-data / docker-exec (should be none when stopped)" 10 \
  'mount | grep -F "$B/docker-" | cut -c1-250 | head -60; echo "count: $(mount | grep -cF "$B/docker-")"'
run "leftover container cgroups" 10 'find /sys/fs/cgroup -maxdepth 3 -type d \( -name "docker*" -o -name "*containerd*" \) 2>/dev/null | head -40'
run "binaries executable?" 15 'ls -la "$B/runtime/docker"; "$B/runtime/docker/dockerd" --version; "$B/runtime/docker/docker" --version; "$B/runtime/docker/containerd" --version'
run "postgres data dir (stale postmaster.pid = unclean stop)" 15 \
  'ls -la "$B/library/postgres" | head -40; echo; echo "postmaster.pid:"; cat "$B/library/postgres/postmaster.pid" 2>&1; echo; du -sh "$B/library/postgres/pg_wal" 2>&1'
run "model cache" 30 'ls -la "$B/library/model-cache"/* 2>&1 | head -40'
run "library sizes (photos may be slow; capped)" 90 'du -sh "$B/library/postgres" "$B/library/model-cache" 2>&1; timeout 60 du -sh "$B/library/photos" 2>&1'
run "swapfile" 10 'ls -la "$B/swapfile" 2>&1'

section "8. BUNDLE LOGS"
run "latest START log (full)" 15 'cat "$B/logs/latest-start.log"'
run "latest STOP log (full — last night's)" 15 'cat "$B/logs/latest-stop.log"'
run "all stop logs: first and last lines of each" 15 'for f in $(ls -tr "$B"/logs/stop-*.log 2>/dev/null | tail -5); do echo "== $f"; head -3 "$f"; echo ...; tail -8 "$f"; done'
run "latest cleanup/upgrade logs (tail)" 15 'for f in latest-cleanup.log latest-upgrade.log; do echo "== $f"; tail -30 "$B/logs/$f" 2>&1; done'
run "dockerd.log: size, owner, last 200 lines" 15 'ls -la "$B/logs/dockerd.log"; tail -200 "$B/logs/dockerd.log"'
run "dockerd.log: every error/warning line (last 150)" 15 'grep -E "level=(error|warning|fatal)" "$B/logs/dockerd.log" | tail -150'
run "dockerd.log: each startup/shutdown, to see the history" 15 'grep -nE "Starting up|Daemon has completed initialization|Processing signal|Daemon shutdown complete|API listen" "$B/logs/dockerd.log" | tail -40'

section "9. DOCKER (only if its socket answers)"
D="env DOCKER_HOST=unix://$B/docker-data/docker.sock DOCKER_CONFIG=$B/dockerconfig $B/runtime/docker/docker"
export D
run "docker info" 20 '$D info 2>&1 | head -60'
run "containers" 20 '$D ps -a'
run "container states" 30 'for c in immich_server immich_machine_learning immich_postgres immich_redis immich_map_tiles; do echo "$c: $($D inspect -f "{{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}} exit={{.State.ExitCode}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}" $c 2>&1)"; done'
run "container resource use" 30 '$D stats --no-stream'
run "container logs (last 80 each)" 90 'for c in immich_server immich_machine_learning immich_postgres immich_redis immich_map_tiles; do echo "======== $c"; $D logs --tail 80 -t $c 2>&1; done'

section "10. NETWORKING PREREQUISITES"
run "kernel modules" 10 'lsmod | grep -E "^(overlay|br_netfilter|bridge|veth|nf_tables|nf_nat|ip_tables|iptable_nat|xt_)" ; echo; modprobe -n -v br_netfilter 2>&1'
run "iptables flavour and rules" 15 'iptables --version; iptables -S 2>&1 | head -40; iptables -t nat -S 2>&1 | head -30'
run "interfaces" 10 'ip -br addr'
run "listening ports (2283 server, 3003 ml, 8082 maps, 5432 db)" 10 'ss -ltnp | grep -E ":(2283|3003|8082|5432|6379)\b" || echo "none of the immich ports are listening"'
run "immich ping" 10 'wget -q -O - -T 5 http://localhost:2283/api/server/ping; echo'

section "11. OPTIONAL: FOREGROUND DOCKERD TEST"
if [ "$DOCKERD_TEST" -eq 1 ]; then
  if pgrep -x dockerd >/dev/null || pgrep -x containerd >/dev/null; then
    echo "SKIPPED: a dockerd/containerd is already running — not starting a second one:"
    pgrep -ax 'dockerd|containerd'
  else
    run "dockerd --debug for 30s, then stopped" 45 '
      cd "$B"
      PATH="$B/runtime/docker:$PATH" timeout -k 10 30 "$B/runtime/docker/dockerd" --debug \
        --data-root="$B/docker-data" --exec-root="$B/docker-exec" \
        --host="unix://$B/docker-data/docker.sock" --pidfile="$B/docker-data/dockerd.pid" \
        --userland-proxy-path="$B/runtime/docker/docker-proxy" 2>&1 | head -400
      echo "dockerd exited (timeout code 124 means it was still running after 30s, which is normal)"'
    run "anything left behind by the test" 10 'pgrep -af "dockerd|containerd" || echo "nothing left running (good)"'
  fi
else
  echo "not requested (run with --with-dockerd-test to include it)"
fi

section "DONE"
echo "finished: $(date)"
echo "log: $LOG (copying to $B/logs/ and $SCRIPT_DIR/ as well)"
sleep 1
for dest in "$B/logs" "$SCRIPT_DIR"; do
  [ -d "$dest" ] && [ "$dest" != /tmp ] && timeout 30 cp "$LOG" "$dest/" 2>/dev/null && chmod a+r "$dest/$(basename "$LOG")"
done
chmod a+r "$LOG"
rm -rf "$TMPD"
