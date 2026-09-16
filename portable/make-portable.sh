#!/usr/bin/env bash
#
# Builds a self-contained folder that runs this customised version of Immich on a machine with no
# internet connection at all. Run this on a computer that DOES have internet and Docker, then copy the
# finished folder to the offline machine (external drive, thumbdrive, whatever).
#
#   bash make-portable.sh
#
# Options:
#   --version TAG     release to package (default: latest)
#   --output DIR      where to build the folder (default: ./immich-portable)
#   --maps DIR        copy offline map tiles from an existing map-tiles folder
#   --docker-version  static Docker binaries to bundle (default: 29.8.1)
#
# The offline machine needs no Docker install: the folder carries its own.
set -euo pipefail

VERSION=latest
OUTPUT=./immich-portable
MAPS=
DOCKER_VERSION=29.8.1
REGISTRY=ghcr.io/ssjrocks
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --maps) MAPS="$2"; shift 2 ;;
    --docker-version) DOCKER_VERSION="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

say() { echo; echo "==> $*"; }
die() { echo; echo "ERROR: $*" >&2; exit 1; }

# Some machines have curl, some have wget. Use whichever is there.
download() { # <url> <destination>
  if command -v curl >/dev/null; then
    curl -fsSL "$1" -o "$2"
  else
    wget -q -O "$2" "$1"
  fi
}

# ----------------------------------------------------------------------------------- checks
say "Checking this computer"
command -v docker >/dev/null || die "Docker isn't installed. Install it from https://docs.docker.com/get-docker/ and try again."
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker and try again."
command -v curl >/dev/null || command -v wget >/dev/null || die "neither curl nor wget is installed."
command -v tar >/dev/null || die "tar isn't installed."
for f in start-immich.sh stop-immich.sh cleanup.sh upgrade.sh docker-compose.portable.yml env.portable map-tiles.conf; do
  [ -f "$SOURCE_DIR/$f" ] || die "missing $f next to this script — download the whole portable folder, not just this file."
done

mkdir -p "$OUTPUT" || die "can't create $OUTPUT"
OUTPUT="$(cd "$OUTPUT" && pwd)"
available_gb=$(df -Pk "$OUTPUT" | awk 'NR==2 {print int($4/1024/1024)}')
[ "${available_gb:-0}" -ge 15 ] || die "only ${available_gb}GB free where the folder is being built; about 15GB is needed (more with map tiles)."
echo "  building in $OUTPUT (${available_gb}GB free)"
echo "  version: $VERSION"

mkdir -p "$OUTPUT"/{images,model-cache-seed,runtime/docker,map-tiles/serve,logs}

# ----------------------------------------------------------------------------------- scripts
say "Copying the offline scripts"
for f in start-immich.sh stop-immich.sh cleanup.sh upgrade.sh docker-compose.portable.yml; do
  cp -f "$SOURCE_DIR/$f" "$OUTPUT/$f"
done
cp -f "$SOURCE_DIR/map-tiles.conf" "$OUTPUT/map-tiles/map-tiles.conf"
[ -f "$OUTPUT/.env.portable" ] || cp -f "$SOURCE_DIR/env.portable" "$OUTPUT/.env.portable"
chmod +x "$OUTPUT"/*.sh
echo "  done"

# ----------------------------------------------------------------------------------- images
# The offline start script loads images/*.tar and expects these names, so each image is re-tagged to the
# name the portable compose file uses before it's saved.
save_image() { # <pull ref> <local tag> <tar name>
  echo "  $3"
  docker pull -q "$1" >/dev/null || die "couldn't download $1 (is the release published?)"
  if [ "$1" = "$2" ]; then
    # pinned by digest: can't be re-tagged, and the offline start script tags it by image id anyway
    docker save "$1" -o "$OUTPUT/images/$3"
  else
    docker tag "$1" "$2"
    docker save "$2" -o "$OUTPUT/images/$3"
  fi
}

say "Downloading the application images (this is the slow part)"
save_image "$REGISTRY/immich-server:$VERSION" immich-server:latest immich-server.tar
save_image "$REGISTRY/immich-machine-learning:$VERSION" immich-machine-learning:latest immich-machine-learning.tar

# The database, cache and map server images are pinned in the portable compose file; read them from there
# so the bundle and the compose file can never drift apart.
postgres_ref=$(grep -oE 'ghcr\.io/immich-app/postgres:[^ ]+' "$SOURCE_DIR/docker-compose.portable.yml" | head -1)
valkey_ref=$(grep -oE 'docker\.io/valkey/valkey:[^ ]+' "$SOURCE_DIR/docker-compose.portable.yml" | head -1)
nginx_ref=$(grep -oE '^\s*image: nginx:[^ ]+' "$SOURCE_DIR/docker-compose.portable.yml" | awk '{print $2}' | head -1)
[ -n "$postgres_ref" ] && [ -n "$valkey_ref" ] && [ -n "$nginx_ref" ] || die "couldn't read the image names from docker-compose.portable.yml"
save_image "$postgres_ref" "$postgres_ref" postgres.tar
save_image "$valkey_ref" "$valkey_ref" valkey.tar
save_image "$nginx_ref" "$nginx_ref" nginx.tar

# ----------------------------------------------------------------------------------- models
# Nothing can be downloaded on the offline machine, so every model it will ever use is fetched here. The
# machine-learning image downloads them itself, through the same code the app uses, so the files land in
# exactly the layout it looks for.
preload_models() { # <label> <expected files, comma separated> <env args...>
  local label="$1" expected="$2"; shift 2
  echo "  $label"
  docker rm -f immich_portable_preload >/dev/null 2>&1 || true
  docker run --rm -d --name immich_portable_preload \
    -v "$OUTPUT/model-cache-seed:/cache" "$@" \
    "$REGISTRY/immich-machine-learning:$VERSION" >/dev/null || die "couldn't start the machine-learning image"
  local waited=0 have_all file
  while [ "$waited" -lt 3600 ]; do
    have_all=1
    for file in ${expected//,/ }; do
      [ -s "$OUTPUT/model-cache-seed/$file" ] || have_all=0
    done
    if [ "$have_all" -eq 1 ]; then
      sleep 5 # let the last file finish being written
      docker stop immich_portable_preload >/dev/null 2>&1 || true
      return 0
    fi
    if ! docker ps --format '{{.Names}}' | grep -q '^immich_portable_preload$'; then
      docker logs immich_portable_preload 2>&1 | tail -20
      die "the machine-learning image stopped while downloading models"
    fi
    sleep 10
    waited=$((waited + 10))
  done
  docker stop immich_portable_preload >/dev/null 2>&1 || true
  die "models took longer than an hour to download"
}

say "Downloading the machine-learning models (several GB)"
preload_models "search, faces, text recognition, and Whisper Medium for subtitles" \
  "clip/ViT-B-32__openai/visual/model.onnx,clip/ViT-B-32__openai/textual/model.onnx,facial-recognition/buffalo_l/detection/model.onnx,facial-recognition/buffalo_l/recognition/model.onnx,ocr/PP-OCRv5_mobile/detection/model.onnx,ocr/PP-OCRv5_mobile/recognition/model.onnx,transcription/faster-whisper-medium/recognition/model.bin" \
  -e MACHINE_LEARNING_PRELOAD__CLIP__VISUAL=ViT-B-32__openai \
  -e MACHINE_LEARNING_PRELOAD__CLIP__TEXTUAL=ViT-B-32__openai \
  -e MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__DETECTION=buffalo_l \
  -e MACHINE_LEARNING_PRELOAD__FACIAL_RECOGNITION__RECOGNITION=buffalo_l \
  -e MACHINE_LEARNING_PRELOAD__OCR__DETECTION=PP-OCRv5_mobile \
  -e MACHINE_LEARNING_PRELOAD__OCR__RECOGNITION=PP-OCRv5_mobile \
  -e MACHINE_LEARNING_PRELOAD__SUBTITLES__TRANSCRIPTION=faster-whisper-medium
preload_models "Whisper Large-v3 for subtitles" \
  "transcription/faster-whisper-large-v3/recognition/model.bin" \
  -e MACHINE_LEARNING_PRELOAD__SUBTITLES__TRANSCRIPTION=faster-whisper-large-v3

# The models were written by the container as root; make them readable to copy around.
docker run --rm --entrypoint chmod -v "$OUTPUT/model-cache-seed:/cache" \
  "$REGISTRY/immich-machine-learning:$VERSION" -R a+rX /cache >/dev/null 2>&1 || true

missing=
for f in clip/ViT-B-32__openai/visual/model.onnx facial-recognition/buffalo_l/recognition/model.onnx \
         ocr/PP-OCRv5_mobile/recognition/model.onnx transcription/faster-whisper-medium/recognition/model.bin \
         transcription/faster-whisper-large-v3/recognition/model.bin; do
  [ -s "$OUTPUT/model-cache-seed/$f" ] || missing="$missing $f"
done
[ -z "$missing" ] || die "these models didn't download:$missing"

# ----------------------------------------------------------------------------------- docker binaries
say "Downloading Docker itself, so the offline machine doesn't need it installed"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
download "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" "$tmp/docker.tgz" \
  || die "couldn't download Docker ${DOCKER_VERSION}; pass --docker-version with a version from https://download.docker.com/linux/static/stable/x86_64/"
tar -xzf "$tmp/docker.tgz" -C "$tmp"
cp -f "$tmp"/docker/* "$OUTPUT/runtime/docker/"
download "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  "$OUTPUT/runtime/docker/docker-compose-linux-x86_64" || die "couldn't download Docker Compose"
chmod +x "$OUTPUT"/runtime/docker/*
echo "  done"

# ----------------------------------------------------------------------------------- map tiles
if [ -n "$MAPS" ]; then
  say "Copying offline map tiles"
  [ -d "$MAPS" ] || die "$MAPS isn't a folder"
  cp -a "$MAPS"/. "$OUTPUT/map-tiles/"
  echo "  done"
else
  say "Skipping offline map tiles"
  echo "  The map will be blank offline. To include maps, pass --maps /path/to/map-tiles"
  echo "  (a folder containing serve/ with a .pmtiles archive and style files)."
fi

# ----------------------------------------------------------------------------------- done
size=$(du -sh "$OUTPUT" | cut -f1)
say "Finished: $OUTPUT ($size)"
cat <<EOF

Next steps:

  1. Copy the whole folder to the offline machine. It must be on a Linux filesystem (ext4),
     not exFAT or NTFS, and needs about 20GB free plus room for your photos.
  2. On that machine:

       cd /path/to/$(basename "$OUTPUT")
       ./start-immich.sh

  3. Open http://localhost:2283 and create your admin account.

  Stop it with ./stop-immich.sh before unplugging the drive.
EOF
