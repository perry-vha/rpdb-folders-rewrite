# RPDB Folders (rewrite)

![Node 22.23.4+ / 24.22.1+](https://img.shields.io/badge/node-22.23.4%2B%20%7C%2024.22.1%2B-339933?logo=node.js&logoColor=white)
![Tests](https://img.shields.io/badge/tests-68%20passing-brightgreen)
![Docker](https://img.shields.io/badge/docker-supported-2496ED?logo=docker&logoColor=white)

Self-hosted poster manager for media libraries. It watches your movie and series folders and writes posters, backdrops and logos into each title's folder, ready for Plex, Jellyfin, Emby and similar servers. A web UI on port 8750 handles setup, matching, styling and previews.

It is an independent reimplementation of RPDB Folders. It adds a **local render engine** that works without an RPDB subscription and shares one design system with the RPDB engine.

> This project is not affiliated with RPDB, OpenPosterDB, TMDB, MDBList or any rating provider. Provider names and logos belong to their owners.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Docker](#docker)
- [Configuration](#configuration)
- [Usage](#usage)
- [Engines](#engines)
- [Poster Designer](#poster-designer)
- [Radarr and Sonarr webhooks](#radarr-and-sonarr-webhooks)
- [Command line](#command-line)
- [Project layout](#project-layout)
- [Development](#development)
- [Known gaps](#known-gaps)
- [Credits](#credits)

## Features

**Library automation**
- Watches movie and series folders (filesystem events, polling or webhooks) and fills in missing images.
- Full and overwrite scans, retry rules for recent titles, and a scheduler.
- Folder-name parsing with embedded IMDb, TMDB and TVDB ids, plus Fix Match.
- Matching by IMDb search, TMDB search, and Plex ids, in a configurable order.
- Plex client with a refresh queue.
- Optional password for the UI. Config is written atomically, and a corrupt file is backed up before starting fresh.

**Images**
- Posters, backdrops and logos, with per-title, per-folder and global styles.
- Automatic media badges from mediainfo: resolution, HDR, audio, codec, language and country flags.
- Custom and created posters, and a poster picker backed by TMDB.

**Local render engine**
- Renders on your machine, so no RPDB key is required.
- Up to 16 rating sources: IMDb, TMDB, Rotten Tomatoes (critics and audience), Metacritic (critics and users), Trakt, Letterboxd, MyAnimeList, MDBList, Roger Ebert, Common Sense, US age rating, and Overall, Critics and Audience averages.
- Three icon styles: OpenPosterDB style, OpenPosterDB official logos, and an RPDB-like pack, including Certified Fresh and Must-See icons.
- Badge tiles (split, block, box) or bars, in rows or columns, at any position.
- Options for skew, corner radius up to a full pill, stroke, padding, margin, gap, opacity, font and scale, number format, and image frames.
- Backdrop and logo output, including backdrop certification badges.

## Quick start

Requires Node 22.23.4, 24.22.1, 26.12.1 or newer. Earlier releases are affected by the October 2026 Node.js security fixes. Docker and CI follow the latest Node release.

    git clone <your-repo-url>
    cd rpdb-folders-rewrite
    npm ci
    npm start -- --no-browser

Open http://localhost:8750/ and add your media folders. Add API keys under **API Keys**.

## Docker

Images are published to GitHub Container Registry on every push to `main` by [the Docker workflow](.github/workflows/docker.yml). Edit the volume paths in [docker-compose.yml](docker-compose.yml), then:

    docker compose pull
    docker compose up -d

To build locally instead:

    docker compose up -d --build

Or run the published image directly:

    docker run -d -p 8750:8750 -v ./config:/rpdb/config -v /path/to/media:/rpdb/mounts/media ghcr.io/perry-vha/rpdb-folders-rewrite:latest

Or build and run directly:

    docker build -t rpdb-folders .
    docker run -d -p 8750:8750 -v ./config:/rpdb/config -v /path/to/media:/rpdb/mounts/media rpdb-folders

Media is read from `/rpdb/mounts` and settings persist in `/rpdb/config`. The container runs as user `node` (uid 1000), so set `user:` in the compose file to match your media ownership, or the app can't write images.

## Configuration

### API keys

Enter keys in the UI under **API Keys**. They are stored in the local config directory and never in this repository.

| Key | Used for | Required |
| --- | --- | --- |
| RPDB | The RPDB engine | Only for the RPDB engine |
| TMDB | Alternative poster lists, TMDB and TVDB matching, artwork for the Local engine. Accepts a v3 key or a v4 read token. | Only for the Local engine |
| MDBList | Ratings and certifications | Only for ratings on the Local engine |

TMDB keys are free from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) and MDBList keys from [mdblist.com/preferences](https://mdblist.com/preferences/). The `TMDB_API_KEY` environment variable overrides the UI value.

You can save up to 5 MDBList keys. When one reaches its daily request limit, the next key is used. When every key has reached its limit, the queue pauses at the current title and carries on when the first limit resets, or straight away if you add another key.

### Config location

| Platform | Path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\RPDB-Folders` |
| macOS | `~/Library/Application Support/RPDB-Folders` |
| Linux | `~/.config/RPDB-Folders` |
| Docker | `/rpdb/config` |

Override it with `RPDB_CONFIG_DIR`.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `RPDB_CONFIG_DIR` | Config directory |
| `RPDB_MOUNTS_DIR` | Media root shown in the folder browser (default `/rpdb/mounts`) |
| `RPDB_PORT` | HTTP port (default 8750) |
| `RPDB_DOCKER` | Force Docker path defaults |
| `TMDB_API_KEY` | TMDB key, takes precedence over the UI |
| `RPDB_BASE_URL`, `IMDB_SUGGEST_URL`, `TMDB_BASE_URL`, `RPDB_QUEUE_DELAY_MS` | Test overrides |

## Usage

1. Add movie and series folders in the UI.
2. Choose an engine (see below) and enter the keys it needs.
3. Run a full scan, or let the watcher fill in images as titles appear.
4. Open any title to fix a match, pick a different poster, or design its look.

## Engines

| | RPDB engine | Local engine |
| --- | --- | --- |
| Rendering | RPDB service | This app |
| RPDB key | Required | Not needed |
| Artwork | RPDB | TMDB, falling back to the MDBList poster |
| Ratings | RPDB | MDBList |

Switch engines in **Settings**, the Poster Designer, or the **API** menu. For the Local engine, artwork is chosen in this order: your saved choice, textless, poster language and secondary language, then the MDBList poster.

## Poster Designer

One designer drives both engines. Options the RPDB engine can't express are greyed out when it is selected. Designs saved for RPDB are written as RPDB Image Styles and converted back when read.

- Presets, live preview, and reusable templates.
- Rating order and a "never show" list. Sources you pick come first and the rest follow in the default order.
- Sliders for size, font scale, corners, stroke, padding, margin, gap, opacity, limit and insets.
- **Check with RPDB** renders the same design on the real service for side-by-side comparison.
- Overrides at global, folder and single-title level.

Layout limits follow what RPDB does: poster rows show at most 3 ratings, side bars and backdrop columns show 6, logos drop ratings that don't fit, and oversized fonts clip at the edge.

## Radarr and Sonarr webhooks

Point Radarr and Sonarr at these URLs, then enable the webhook option in **Settings**:

    http://<host>:8750/radarr
    http://<host>:8750/sonarr

If a UI password is set, webhook requests must supply it. Duplicate Sonarr events for the same path are ignored.

## Command line

| Flag | Effect |
| --- | --- |
| `--no-browser` | Don't open the UI on start |
| `--host=<host>` | Bind address |
| `--port=<n>` | HTTP port |
| `--remote=<command>` | Send a command such as `full-scan` to a running instance |

## Project layout

| Path | Contents |
| --- | --- |
| `src/index.js`, `src/server.js` | Entry point, Express server and routes |
| `src/look.js`, `src/compose.js` | Unified design schema and the single renderer |
| `src/local-poster.js`, `src/media-badges.js` | Local engine glue and media badge drawing |
| `src/match.js`, `src/parse.js` | Title matching and folder-name parsing |
| `src/ratings.js`, `src/rpdb.js`, `src/plex.js` | MDBList ratings, RPDB client, Plex client |
| `src/watcher.js`, `src/scheduler.js`, `src/engine.js` | Folder watching, scheduling, scan engine |
| `static/` | Web UI, fonts, icons and flags |
| `tools/` | Scripts that generate and measure the icon packs |
| `test/` | Unit and integration tests, with a mock RPDB, IMDb and TMDB server |

## Development

    npm ci
    npm test        # node:test, 68 tests

Run against a throwaway config so your real settings stay untouched:

    # PowerShell
    $env:RPDB_CONFIG_DIR="$env:TEMP\rpdb-dev"; node src/index.js --no-browser --port=8751

    # bash
    RPDB_CONFIG_DIR=/tmp/rpdb-dev node src/index.js --no-browser --port=8751

Server code needs a restart after changes. Files in `static/` are served fresh.

Contributions are welcome. Open an issue before large changes, keep tests passing, and never commit keys or personal config.

## Known gaps

- Not tested against a live Plex server, or against real video files for mediainfo probing.
- The Docker image has not been built on the development machine.
- Windows network drives are not browsable, only drive letters.

## Credits

- Rating icons and the source mapping come from [OpenPosterDB](https://github.com/PNRxA/openposterdb) (MIT, see `static/icons/LICENSE-openposterdb.txt`).
- Flags: [flag-icons](https://github.com/lipis/flag-icons).
- Fonts: Arimo, Inter and Roboto, each with its license in `static/fonts/`.
- Ratings data: [MDBList](https://mdblist.com). Artwork: [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
