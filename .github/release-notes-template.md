A customised version of Immich — **not** the official app. See the [README](https://github.com/ssjrocks/immich#-this-fork) for what it adds, and the disclaimer.

## Install — one command

```bash
curl -fsSL https://raw.githubusercontent.com/ssjrocks/immich/main/install.sh | bash
```

No `curl`? Use `wget -qO- https://raw.githubusercontent.com/ssjrocks/immich/main/install.sh | bash`

You need [Docker](https://docs.docker.com/get-docker/). The command makes a folder, writes the settings for you (including a randomly generated database password), downloads the images below, starts everything, and prints the address to open — usually <http://localhost:2283>. Create your admin account there. Nothing to edit.

Options if you want them, for example:

```bash
curl -fsSL https://raw.githubusercontent.com/ssjrocks/immich/main/install.sh | bash -s -- --dir /srv/immich --port 3000 --version __TAG__
```

## Offline machine (no internet at all) — one command

Run this on a computer that **does** have internet:

```bash
curl -fsSL https://raw.githubusercontent.com/ssjrocks/immich/main/portable/make-portable.sh -o make-portable.sh && bash make-portable.sh
```

It builds a self-contained folder (about 8 GB) holding Docker itself, these images, every machine-learning model — search, faces, text recognition and both subtitle models — and an offline world map. Copy that folder to the offline machine (it needs a Linux filesystem), then run `./start-immich.sh` there. Nothing is ever downloaded on that machine. See [portable/README.md](https://github.com/ssjrocks/immich/blob/main/portable/README.md).

## Already running an older release?

Back up first — updates change the database, and that can't be undone.

```bash
cd /path/to/your/immich/folder && docker compose pull && docker compose up -d
```

## Images

- `ghcr.io/ssjrocks/immich-server:__TAG__`
- `ghcr.io/ssjrocks/immich-machine-learning:__TAG__`
