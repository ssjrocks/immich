# Portable offline Immich: the full guide

This guide takes you from nothing to a photo library running on a machine with no internet, and covers
everyday use, backups, updates and fixing problems. For the short version, see [README.md](README.md).

- [How it works](#how-it-works)
- [What you need](#what-you-need)
- [1. Prepare a drive](#1-prepare-a-drive)
- [2. Build the folder](#2-build-the-folder)
- [3. Copy it to the offline machine](#3-copy-it-to-the-offline-machine)
- [4. First start](#4-first-start)
- [5. Everyday use](#5-everyday-use)
- [6. Turning on the extra features](#6-turning-on-the-extra-features)
- [7. The offline map](#7-the-offline-map)
- [8. Backing up](#8-backing-up)
- [9. Updating, and going back](#9-updating-and-going-back)
- [10. Troubleshooting](#10-troubleshooting)
- [Reference: every file in the folder](#reference-every-file-in-the-folder)

## How it works

The folder carries everything Immich needs, so the offline machine installs nothing and downloads nothing:

- **Docker itself**, as Docker's official standalone programs, run straight from the folder. It keeps all of
  its data inside the folder too, and never touches a Docker that might already be installed on the machine.
- **The application images**, saved as files and loaded into that Docker on the first start.
- **Every machine-learning model** the app can use: smart search, faces, text recognition, and both Whisper
  models for video subtitles.
- **An offline world map**, served by a small web server in the folder.

When you run `./start-immich.sh`, it:

1. Checks the machine: memory, free space, and the tools Docker needs.
2. Turns on a 4 GB swapfile on the drive, created the first time if there's room. Live USB sessions usually
   have no swap, and without it running out of memory can kill everything at once.
3. Starts the bundled Docker, with its data in `docker-data/`.
4. **First start only:** loads the image files from `images/`.
5. Copies any model from `model-cache-seed/` that isn't in `library/model-cache/` yet.
6. Starts five containers:

   | Container | What it does | Port |
   | --- | --- | --- |
   | `immich_server` | The app and its web page | 2283 |
   | `immich_machine_learning` | Search, faces, text recognition, subtitles | 3003 |
   | `immich_postgres` | The database, stored in `library/postgres` | |
   | `immich_redis` | The job queue | |
   | `immich_map_tiles` | The offline map | 8082 |

7. Waits for the app to answer, points its map at the offline one (first start only), and opens your browser
   at <http://localhost:2283>.

Everything that matters to you lives in **`library/`**: your photos and videos, the database, and the live
model cache. Everything else can be rebuilt.

## What you need

**To build the folder:** a computer with internet and [Docker](https://docs.docker.com/get-docker/), and
about 20 GB free. Linux or macOS; on Windows, use WSL.

**To run it:**

- A 64-bit Intel/AMD **Linux** machine. An installed Ubuntu works, and so does an Ubuntu live USB session.
- **`sudo`** access (Docker needs root). On an Ubuntu live session the default user already has it, with no
  password.
- `iptables` and the `overlay` kernel module. Normal Ubuntu desktop systems have both.
- **8 GB of RAM or more.** Video subtitles and full video face scanning want more.
- A drive with a **Linux filesystem**, see below.

## 1. Prepare a drive

The folder must sit on **ext4** (or another Linux filesystem). exFAT and NTFS, which most USB drives come
with, can't store the permissions and links Docker needs, and Docker will fail in confusing ways on them.

Allow **about 20 GB** for the folder itself, plus room for your photos and videos.

On Ubuntu, the easiest way is the **Disks** app: select the drive, delete its partition, and create a new one
formatted as **Ext4**. Tick **Password protect volume (LUKS)** if you want the drive encrypted: the scripts
don't mind, as long as the drive is unlocked and mounted before you run them.

From a terminal instead, with the right device name (check it with `lsblk`; formatting erases the drive):

```bash
sudo mkfs.ext4 -L immich /dev/sdX1
```

## 2. Build the folder

On the computer **with** internet:

```bash
curl -fsSL https://raw.githubusercontent.com/ssjrocks/immich/main/portable/make-portable.sh -o make-portable.sh && bash make-portable.sh
```

(no `curl`? use `wget -q -O make-portable.sh` with the same address)

It downloads the latest release's images, every model, Docker's standalone programs, and the offline map
(about 3.7 GB of that, from the [offline map release](https://github.com/ssjrocks/immich/releases/tag/offline-map-z10)).
Expect it to take a while. You end up with an `immich-portable` folder of about 8 GB.

Useful options:

| Option | What it does |
| --- | --- |
| `--output /media/you/immich/immich-portable` | Build straight onto the drive (it must already be ext4) |
| `--version v3.2.1-fork.2` | A specific [release](https://github.com/ssjrocks/immich/releases) instead of the latest |
| `--maps DIR` | Copy the map from an existing `map-tiles` folder instead of downloading it again |
| `--no-maps` | Leave the map out: saves 3.7 GB, but the map is blank offline |
| `--docker-version X` | Bundle a different version of Docker |

## 3. Copy it to the offline machine

If you didn't build straight onto the drive, copy the whole folder across in a way that keeps permissions:

```bash
sudo rsync -a --info=progress2 immich-portable/ /media/you/immich/immich-portable/
```

Dragging it in a file manager onto an exFAT/NTFS drive, or through Windows, loses the permissions. The start
script puts back the "executable" flag on its own programs, but it can't fix a non-Linux filesystem.

## 4. First start

On the offline machine, open a terminal in the folder:

```bash
cd /media/you/immich/immich-portable
./start-immich.sh
```

The first start takes a few minutes: it unpacks the images (about 7 GB once unpacked) and copies the models
into place. It checks for enough free space before it begins, and stops with a clear message if there isn't.

When it's ready your browser opens at <http://localhost:2283>. Create your admin account there: it lives only
in this library's database, nothing is sent anywhere.

Later starts skip the unpacking and are much quicker.

## 5. Everyday use

**Start:** `./start-immich.sh`. Safe to run any time, including when it's already running.

**Stop, before you unplug the drive or shut down:**

```bash
./stop-immich.sh
```

Wait until it prints **"Safe to unplug the drive now."** It stops the containers cleanly so the database
isn't cut off mid-write, stops Docker, and turns off the swapfile. Unplugging a drive with an active swapfile
on it can crash the whole system.

If stopping takes much longer than a minute, don't pull the drive or force a shutdown: that is the situation
where data gets damaged. Run the [diagnostic script](#the-diagnostic-script) in a second terminal instead.

**Adding photos:** use the upload button on the web page (you can drag a whole selection of files onto it),
or the official Immich phone app pointed at this computer's address on a local network. Copying files
straight into `library/photos` doesn't add them: that folder is Immich's own storage, not a folder it
watches.

## 6. Turning on the extra features

The video features are off by default, because they're heavy CPU work. All of them work offline: the
models are already in the folder.

| Feature | Turn it on | Then |
| --- | --- | --- |
| Faces throughout videos | Administration → Settings → Machine Learning → Facial Recognition → **Video face scanning** | Administration → Job Queues → **Video face detection** → **All** |
| Video subtitles | Administration → Settings → Machine Learning → **Video subtitles**: enable, pick Medium or Large-v3 | Administration → Job Queues → **Video subtitles** → **Missing** |
| Browse page | Always on | **Browse** in the sidebar |

**Don't change the models** for search, faces or text recognition in the settings. Only the bundled ones are
present (`ViT-B-32__openai`, `buffalo_l`, `PP-OCRv5_mobile`), and any other one would try to download and
fail. For subtitles, only Whisper Medium and Large-v3 are offered, for the same reason.

Subtitles run on the CPU and are slow: a long video can take a good fraction of its own length. Large-v3 is
roughly 2–3 times slower than Medium.

## 7. The offline map

The map covers the whole world down to about neighbourhood level (zoom 10). You can zoom further, the map
just stops adding detail.

On the first start Immich is pointed at it automatically. If map styles had already been set (say, on a
library you're upgrading), they're left alone; to use the offline map, set these under
**Administration → Settings → Map & GPS Settings**:

| Field | Value |
| --- | --- |
| Light style | `http://localhost:8082/style-light.json` |
| Dark style | `http://localhost:8082/style-dark.json` |

The map is drawn by your browser, so `localhost` means "this computer". From a different device on a
network the map stays blank, unless you replace `localhost` with this computer's IP address both in those
settings and inside `map-tiles/serve/style-light.json` and `style-dark.json`.

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Tiles and styles by
[Protomaps](https://protomaps.com).

## 8. Backing up

Back up **`library/`**. Stop Immich first, and copy with `sudo`, because the database files belong to the
database's own user:

```bash
./stop-immich.sh
sudo rsync -a library/ /media/you/backup/immich-library/
```

To restore, stop Immich, copy it back the same way, and start again.

## 9. Updating, and going back

1. On the computer with internet, build a fresh folder with `make-portable.sh`.
2. **Back up `library/`** as above, and keep a copy of the current `images/*.tar` files: going back needs both.
3. Copy the new `images/*.tar` over the old ones. Also copy the scripts, `docker-compose.portable.yml`, and
   `model-cache-seed/` if models were added. The scripts don't update themselves.
4. On the offline machine:

   ```bash
   ./upgrade.sh
   ```

   This stops Immich, clears Docker's own state so the new images are loaded fresh, and starts again. It
   never touches `library/`.

**Why the backup matters:** a new version updates the database the first time it starts, and that can't be
undone. An older version can't open the updated database.

**Going back:** put the old image files back in `images/`, restore your `library/` backup, and run
`./upgrade.sh` again.

## 10. Troubleshooting

### Where to look first

Every script writes everything it does to the **`logs/`** folder on the drive, so you can read back what
happened even after a crash or reboot:

| File | What's in it |
| --- | --- |
| `logs/latest-start.log` | The last start, ending with a **state dump**: memory, swap, disk, every container's status, and the last 40 log lines of any container that isn't running |
| `logs/latest-stop.log` | The last stop |
| `logs/dockerd.log` | Docker's own log, across every run |
| `logs/start-<date-time>.log` etc. | Every earlier run |

Read the end of the last start first:

```bash
tail -80 logs/latest-start.log
```

Where it stopped tells you which stage failed:

| Last thing it did | The problem is with |
| --- | --- |
| `waiting for dockerd to come up...` | Docker itself: see `logs/dockerd.log` and the first problem below |
| `docker load` or `starting docker compose stack` | The images |
| `waiting for immich-server to become healthy...` | One of the containers: the state dump shows which |
| `done.`, but something doesn't work | The app: look at the logs of the container for that feature |

### The diagnostic script

`immich-diag.sh` gathers everything useful into one log file you can carry to another computer or attach to
an [issue](https://github.com/ssjrocks/immich/issues):

```bash
sudo bash immich-diag.sh
```

It records boot and shutdown history, memory and CPU pressure, processes stuck waiting on the drive, kernel
errors (USB resets, I/O errors, out-of-memory kills), the drive's health and read/write speed, the state of
the folder (leftover Docker processes, mounts, a stale database lock), every log above, and each container's
status and recent logs. It changes nothing except a short disk write test, and every check has a time limit,
so a hung drive can't stall it.

The log goes to `/tmp/immich-diag-<date-time>.log`, and is copied to `logs/` and next to the script. It takes
one to three minutes.

If Docker won't start, run it again with `--with-dockerd-test`: it starts Docker in the foreground for 30
seconds so its errors are recorded directly, then stops it.

### Running Docker commands by hand

The folder's Docker isn't the system one, so a plain `docker` command won't see it. In the folder, define a
shortcut:

```bash
D() { sudo env DOCKER_HOST=unix://$PWD/docker-data/docker.sock ./runtime/docker/docker "$@"; }
```

Then, for example:

```bash
D ps -a
```

```bash
D logs --tail 100 immich_server
```

The other containers are `immich_machine_learning`, `immich_postgres`, `immich_redis` and `immich_map_tiles`.

### Common problems

**Docker doesn't start (`dockerd did not come up in 60s`)**

- Read `logs/dockerd.log`. The most common causes are a missing `iptables` program or missing kernel
  modules. Check with `which iptables` and `lsmod | grep -E 'overlay|br_netfilter'`.
- If `dockerd.log` shows **no new lines at all** from this start, Docker never got going. Look for leftovers
  from an earlier session that didn't stop cleanly: `ps -ef | grep -E 'dockerd|containerd'`. Rebooting
  clears them. If they persist, or the system is very slow, suspect the drive (next problem).
- If the drive isn't ext4, Docker fails here too.

**Everything gets very slow, or stopping takes ages**

Usually the drive can't keep up, is failing, or is having USB trouble. Run the diagnostic script and look at
its "stuck processes", "kernel log" and "the drive" sections: processes in state `D`, `I/O error` or
`reset` messages, and a low read or write speed point to the drive. Try a different USB port (ideally USB 3,
directly on the computer rather than through a hub), and check the drive with `sudo dmesg | tail -50`.

**The app never becomes ready**

The state dump at the end of `logs/latest-start.log` shows each container's status and logs. Look for a
container that is `exited` or `restarting`, and read its logs with `D logs`.

**Everything vanished: the terminal closed and nothing is running**

That's typically the system running out of memory. Check with `sudo dmesg | grep -i oom` and `free -h`.
Close other programs, make sure the swapfile was enabled (the start log says so), and leave the heavy video
features off on low-memory machines.

**It started with an empty library instead of mine**

Check you're running `start-immich.sh` from the drive's own copy of the folder, and that `library/` and
`docker-data/` are on the drive you think they are.

**A feature fails with a download or network error**

Something is set to a model that isn't bundled. Put the machine-learning models back to the defaults
listed under [6](#6-turning-on-the-extra-features).

**Starting completely fresh after a failed setup**

```bash
./cleanup.sh
./start-immich.sh
```

`cleanup.sh` removes Docker's own state and the swapfile, so the images are loaded again from scratch. It
never touches `library/`.

## Reference: every file in the folder

| Path | What it is |
| --- | --- |
| `start-immich.sh` | Start everything |
| `stop-immich.sh` | Stop everything cleanly; run before unplugging or shutting down |
| `upgrade.sh` | Load new image files: stop, clean up, start |
| `cleanup.sh` | Reset Docker's own state after a failed start; never touches `library/` |
| `immich-diag.sh` | Collect a diagnostic log |
| `docker-compose.portable.yml` | The list of containers and how they're set up |
| `.env.portable` | Database name, user and password. Change the password **before** the first start if you want to; afterwards changing it here does nothing |
| `images/` | The application, database, cache and map server images |
| `model-cache-seed/` | The bundled machine-learning models |
| `runtime/docker/` | Docker's standalone programs |
| `map-tiles/` | The offline map and its server's settings |
| `library/` | **Your data:** photos and videos, the database, the live model cache. Created on the first start |
| `docker-data/`, `docker-exec/`, `dockerconfig/` | Docker's own working state. Created on start, removed by `cleanup.sh` |
| `swapfile` | The 4 GB swapfile, created on the first start if there's room |
| `logs/` | Every run's full log |
