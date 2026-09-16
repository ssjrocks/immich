#!/usr/bin/env bash
#
# One-command installer for this customised version of Immich (github.com/ssjrocks/immich).
# It is not the official Immich app — see the README for what it adds, and the disclaimer.
#
#   bash install.sh
#
# It creates a folder, writes the settings for you (including a random database password),
# downloads the compose file, starts everything, and tells you where to go.
#
# Options:
#   --dir DIR       where to install (default: ./immich)
#   --port PORT     web port (default: 2283)
#   --version TAG   release to run (default: latest)
set -euo pipefail

DIR=./immich
PORT=2283
VERSION=latest
RAW=https://raw.githubusercontent.com/ssjrocks/immich/main

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

say() { echo; echo "==> $*"; }
die() { echo; echo "ERROR: $*" >&2; exit 1; }
download() { # <url> <destination>
  if command -v curl >/dev/null; then curl -fsSL "$1" -o "$2"; else wget -q -O "$2" "$1"; fi
}

say "Checking this computer"
command -v docker >/dev/null || die "Docker isn't installed. Get it from https://docs.docker.com/get-docker/ and run this again."
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker and run this again."
docker compose version >/dev/null 2>&1 || die "Docker Compose isn't available. Update Docker to a current version."
command -v curl >/dev/null || command -v wget >/dev/null || die "neither curl nor wget is installed."
echo "  looks good"

mkdir -p "$DIR" || die "can't create $DIR"
DIR="$(cd "$DIR" && pwd)"

say "Setting up $DIR"
download "$RAW/docker/docker-compose.release.yml" "$DIR/docker-compose.yml" || die "couldn't download the compose file"
if [ "$PORT" != "2283" ]; then
  sed -i.bak "s/'2283:2283'/'${PORT}:2283'/" "$DIR/docker-compose.yml" && rm -f "$DIR/docker-compose.yml.bak"
fi

if [ -f "$DIR/.env" ]; then
  echo "  keeping the settings already in $DIR/.env"
else
  password=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24 || echo "immich$(date +%s)")
  cat > "$DIR/.env" <<EOF
# Settings for this customised version of Immich (github.com/ssjrocks/immich)

# Where your photos and videos are stored
UPLOAD_LOCATION=./library

# Where the database is stored. Keep this on a local disk: network shares are not supported
DB_DATA_LOCATION=./postgres

# Which release to run: 'latest', or a tag from https://github.com/ssjrocks/immich/releases
IMMICH_VERSION=$VERSION

# Database password, generated when this file was created
DB_PASSWORD=$password

# The values below this line do not need to be changed
###################################################################################
DB_USERNAME=postgres
DB_DATABASE_NAME=immich
EOF
  echo "  wrote $DIR/.env with a generated database password"
fi

say "Downloading and starting Immich (a few minutes the first time)"
(cd "$DIR" && docker compose up -d) || die "Immich didn't start. The messages above say why."

say "Waiting for it to come up"
ready=0
for _ in $(seq 1 90); do
  if command -v curl >/dev/null; then
    curl -fsS "http://localhost:${PORT}/api/server/ping" >/dev/null 2>&1 && { ready=1; break; }
  else
    wget -q -O /dev/null "http://localhost:${PORT}/api/server/ping" 2>/dev/null && { ready=1; break; }
  fi
  sleep 2
done

if [ "$ready" -eq 1 ]; then
  cat <<EOF

  Immich is running.

    Open:     http://localhost:${PORT}
    Folder:   $DIR
    Photos:   $DIR/library

  Create your admin account in the browser. On another device on your network, use this
  computer's address instead of localhost.

  Stop it:    cd $DIR && docker compose stop
  Start it:   cd $DIR && docker compose start
  Update it:  cd $DIR && docker compose pull && docker compose up -d

  Video face scanning and subtitles are off by default — turn them on under
  Administration -> Settings -> Machine Learning.
EOF
else
  echo
  echo "  It hasn't answered yet. Check with:  cd $DIR && docker compose logs immich-server"
fi
