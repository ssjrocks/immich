# Portable, fully offline Immich

This folder builds a **self-contained copy** of this customised version of Immich: one folder you copy to a
computer with **no internet at all**, which then runs without downloading anything, ever.

It carries its own Docker, its own images, and every machine-learning model the app can use (search, faces,
text recognition, and both Whisper models for video subtitles). Optionally an offline world map too.

Handy for an air-gapped machine, a spare laptop with no network, or a photo library on an external drive
you plug in when you need it.

## 1. Build the folder (on a computer WITH internet)

You need [Docker](https://docs.docker.com/get-docker/) running, and about 15 GB free. Linux or macOS;
on Windows use WSL.

```bash
curl -fsSLO https://raw.githubusercontent.com/ssjrocks/immich/main/portable/make-portable.sh
```

Download the rest of this folder next to that script, then run it:

```bash
bash make-portable.sh
```

Or, more simply, clone the repository and run it from there:

```bash
git clone --depth 1 https://github.com/ssjrocks/immich.git && bash immich/portable/make-portable.sh
```

It takes a while: it downloads about 10 GB (the app images and the models). When it finishes you'll have an
`immich-portable` folder.

Options:

| Option | What it does |
| --- | --- |
| `--version TAG` | Package a specific [release](https://github.com/ssjrocks/immich/releases) instead of the latest |
| `--output DIR` | Build the folder somewhere else (for example straight onto a drive) |
| `--maps DIR` | Include offline map tiles by copying them from an existing `map-tiles` folder |
| `--docker-version X` | Bundle a different version of Docker's static binaries |

## 2. Copy it to the offline machine

Copy the whole folder across. Two requirements:

- **A Linux filesystem (ext4).** exFAT and NTFS can't store the permissions and links Docker needs. Use
  `sudo rsync -a` or `cp -a` to keep permissions intact.
- **About 20 GB free**, plus room for your photos and videos.

## 3. Run it

```bash
cd /path/to/immich-portable
./start-immich.sh
```

The first start unpacks the images and copies the models into place, which takes a few minutes. After that
it opens <http://localhost:2283>, where you create your admin account.

Before unplugging the drive or shutting down:

```bash
./stop-immich.sh
```

That stops everything cleanly. Pulling the drive out while it's running can corrupt the database.

## What's in the folder

| | |
| --- | --- |
| `images/` | The application, database, cache and map-server images |
| `model-cache-seed/` | Every machine-learning model, copied into the library on first start |
| `runtime/docker/` | Docker itself, run straight from the folder: nothing is installed on the machine |
| `library/` | Created on first start: your photos, the database, the live model cache. **This is the part to back up** |
| `map-tiles/` | Offline map, if you included one |
| `start-immich.sh`, `stop-immich.sh` | Start and stop |
| `upgrade.sh` | Apply newer image files (see below) |
| `cleanup.sh` | Reset Docker's own state after a failed start. Never touches `library/` |

## Turning on the extra features

Video face scanning and subtitles are off by default, because they're heavy. Turn them on in
**Administration → Settings → Machine Learning**, then run the matching job under
**Administration → Job Queues**. See the [main README](../README.md#turning-on-this-versions-features).

Everything works offline, including subtitles: the models are already in the folder.

## Updating an offline machine

1. On a computer with internet, build a fresh folder with `make-portable.sh`.
2. Copy the new `images/*.tar` (and `model-cache-seed/` if models were added) over the old ones, along
   with the scripts and `docker-compose.portable.yml`.
3. On the offline machine: **back up `library/` first**, then run `./upgrade.sh`.

Upgrades can change the database in ways that can't be undone, and an older version can't open a newer
database, so the backup is what lets you go back.

## Notes

- **Nothing here reaches the internet.** The machine-learning service is told not to download, and every
  model it needs is already present. If you change a model in the settings to one that isn't bundled, that
  feature will fail.
- **The map is blank unless you included tiles.** With `--maps`, point Immich at the bundled map under
  **Administration → Settings → Map** using `http://localhost:8082/style-light.json` and
  `style-dark.json`.
- **Ports used:** 2283 for Immich, 8082 for the map server.
