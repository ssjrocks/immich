# Portable offline Immich

**Your photo library on a drive, running on a computer with no internet at all.**

This folder builds a self-contained copy of [this customised version of Immich](../README.md): one folder
you copy to a drive and run on any Linux machine, which never downloads anything, ever. It's made for
air-gapped machines, a spare laptop with no network, or a library on an external drive you plug in when you
need it, even from an Ubuntu live USB session.

The folder carries:

- **Docker itself**, run straight from the folder: nothing gets installed on the machine
- **The application**, with all of this version's extras: faces throughout videos, the Browse page, and video
  subtitles
- **Every machine-learning model** it can use: smart search, faces, text recognition, and both Whisper
  subtitle models
- **An offline world map**, so photo locations still show on the map

📖 **[The full guide](GUIDE.md)** covers preparing a drive, everyday use, backups, updates and
troubleshooting.

## Quick start

**1. Build the folder** on a computer **with** internet and [Docker](https://docs.docker.com/get-docker/),
with about 20 GB free:

```bash
curl -fsSL https://raw.githubusercontent.com/ssjrocks/immich/main/portable/make-portable.sh -o make-portable.sh && bash make-portable.sh
```

This produces an `immich-portable` folder of about 8 GB.
[Options](GUIDE.md#2-build-the-folder) include building straight onto a drive and picking a release.

**2. Copy it** to a drive with a **Linux filesystem (ext4)**, not exFAT or NTFS, keeping permissions:

```bash
sudo rsync -a immich-portable/ /path/to/drive/immich-portable/
```

**3. Run it** on the offline machine:

```bash
cd /path/to/drive/immich-portable
./start-immich.sh
```

The first start takes a few minutes, then opens <http://localhost:2283>, where you create your admin account.

**Before unplugging the drive or shutting down**, always run:

```bash
./stop-immich.sh
```

and wait for **"Safe to unplug the drive now."** Pulling the drive while it's running can corrupt the database.

## Requirements

| | Building | Running |
| --- | --- | --- |
| System | Linux or macOS (Windows: WSL), with Docker | 64-bit Linux (installed or a live USB session), with `sudo` |
| Disk | About 20 GB free | An ext4 drive with about 20 GB free, plus room for your photos |
| Memory | | 8 GB or more |
| Internet | Yes | **None** |

## What's in the folder

| | |
| --- | --- |
| `start-immich.sh` / `stop-immich.sh` | Start, and stop cleanly |
| `upgrade.sh` | Load newer images ([updating](GUIDE.md#9-updating-and-going-back)) |
| `cleanup.sh` | Reset Docker's own state after a failed start; never touches your library |
| `immich-diag.sh` | Gather a diagnostic log when something goes wrong |
| `library/` | **Your data:** photos, database, model cache. Created on first start. **Back this up** |
| `images/`, `model-cache-seed/`, `runtime/`, `map-tiles/` | The application, models, Docker, and the map |
| `logs/` | A full log of every start and stop |

## Good to know

- **The extra features are off by default**, because they're heavy. Turn them on under
  Administration → Settings → Machine Learning. [How](GUIDE.md#6-turning-on-the-extra-features).
- **Keep the default models.** Only the bundled ones are present, so switching to another model in the
  settings makes that feature fail.
- **Back up `library/` before every update.** A new version updates the database and can't be undone.
  [Backing up](GUIDE.md#8-backing-up).
- **The map** works in a browser on this computer. Other devices on a network need
  [a small change](GUIDE.md#7-the-offline-map).
- **Ports:** 2283 for Immich, 8082 for the map, 3003 for machine learning.

## Something wrong?

Every run is logged to `logs/`. Start with `tail -80 logs/latest-start.log`, then see
[troubleshooting](GUIDE.md#10-troubleshooting). To gather everything in one file to share:

```bash
sudo bash immich-diag.sh
```

Report problems [here](https://github.com/ssjrocks/immich/issues), not to the official Immich team.

## Building the folder from these files

`make-portable.sh` uses the other files in this folder: the start/stop scripts, `docker-compose.portable.yml`,
`env.portable` (copied as `.env.portable`) and `map-tiles.conf`. If you run it on its own it downloads them
from this repository first. It pulls the published images from `ghcr.io/ssjrocks`, has the
machine-learning image download each model into `model-cache-seed/`, and fetches Docker's standalone
programs and the [offline map](https://github.com/ssjrocks/immich/releases/tag/offline-map-z10).
