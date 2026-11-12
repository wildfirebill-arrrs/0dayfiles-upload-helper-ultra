# 0dayfiles upload helper — Ultra.cc seedbox edition (Node.js)

A **headless CLI** for preparing uploads to `0dayfiles.net`, a private UNIT3D
tracker. Built for seedboxes (Ultra.cc) — no GUI, runs over SSH, everything
lives in your home directory.

Drag a release folder in (or point the CLI at it) and it produces a
private-flagged `.torrent`, an `.nfo`, media metadata, a description, hosts
screenshots, and hands a complete submission payload to the tracker — all
from the command line.

## Ultra.cc environment notes

- **No root/sudo.** Node.js is installed via the unofficial language installer
  (NVM + Node + npm) into your home directory:
  ```bash
  bash <(wget -qO- https://scripts.ultra.cc/util-v2/LanguageInstaller/Node-Installer/main.sh)
  # choose option 1
  ```
- **Only use your assigned 5-digit port range** if you expose a web UI.
- Can run as a **userland systemd service** (`~/.config/systemd/user/`).
- HTTPS via Nginx proxy (`~/.apps/nginx/proxy.d/APP-NAME.conf`).
- Be mindful of resource/IO usage (see Ultra.cc SSH troubleshooting guide).

## Install

### 1. Install Node.js on your Ultra slot (one-time)
```bash
bash <(wget -qO- https://scripts.ultra.cc/util-v2/LanguageInstaller/Node-Installer/main.sh)
# choose option 1 to install
```

### 2. Clone this repo
```bash
git clone https://github.com/wildfirebill-arrrs/0dayfiles-upload-helper-ultra.git
cd 0dayfiles-upload-helper-ultra
```

### 3. Install dependencies
```bash
npm install
```

### 4. Copy config and set your announce URL + ImageBB key
```bash
cp config.toml.example config.toml
# edit config.toml, or set via env vars:
export ODFU_TORRENT_ANNOUNCE="https://0dayfiles.net/announce/<passkey>"
export ODFU_IMAGEBB_API_KEY="<your-imgbb-key>"
```
`config.toml` is gitignored — always use `config.toml.example` as a template.

### 5. Ensure mediainfo + ffmpeg are on PATH (needed for probing & screenshots)
`apt`/`pkg` install may not be available without root; use static binaries in your home dir and add to PATH if needed.

### 6. Choose how to run

#### Headless CLI
```bash
node main.js --headless --input "/path/to/Release.Name.2024.1080p.BluRay.x264-GRP"
```

#### Web UI (remote management via browser)
The web UI runs on your assigned Ultra.cc 5-digit port, bound to `127.0.0.1` only.
No config file or Nginx setup required — just set `PORT` and `ROOT_DIR`:

```bash
# Quick start (beats-rename style)
PORT=21345 ROOT_DIR=$HOME node web.js
# or use the helper script:
PORT=21345 ROOT_DIR=$HOME ./start.sh
```

On first run with no password configured, a random password is auto-generated,
printed to the console, and saved to `.auth` (mode 0600). Log in at
`https://username.indigo.usbx.me/app/login` with username `admin` and that
password.

All settings can also be set via `config.toml` (copy from `config.toml.example`)
or env vars (`ODFU_WEB_*`, `PORT`, `ROOT_DIR`, `AUTH_USER`, `AUTH_PASS`,
`AUTH_SECRET`, `FORCE_SECURE`).

```bash
# edit [web] -> port = <your-assigned-port>, e.g. 21345
# optionally set watch_folder for torrent-client auto-load
npm run web
# or: node web.js
```

All `[web]` keys can be overridden via env vars, e.g. `ODFU_WEB_PORT=21345`.
`web.js` refuses to start unless `web.port` is a valid assigned 5-digit port.

### 7. (Recommended) Run as a userland systemd service

```bash
mkdir -p ~/.config/systemd/user
cp odfu-seedbox.service ~/.config/systemd/user/odfu-upload-helper.service
# edit ExecStart to point at `node web.js` (or `node main.js --headless ...`)
systemctl --user daemon-reload
systemctl --user enable --now odfu-upload-helper.service
```

### 8. Nginx proxy for the Web UI (Ultra.cc)

Create `~/.apps/nginx/proxy.d/odfu-upload-helper.conf` (example; adjust the port
and username):

```nginx
location /app/ {
    proxy_pass http://127.0.0.1:21345/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    auth_basic "0dayfiles Upload Helper";
    auth_basic_user_file /home/USER/.htpasswd;
}
```
Then `~/.apps/nginx/nginx_proxy_reload`. Access via
`https://username.indigo.usbx.me/app/`.

## CLI usage

```bash
# Build artifacts for a local release folder
node main.js --headless --input "Movie.Name.2024.1080p.BluRay.x264-GRP"

# Cross-seed from an existing .torrent (no local files, no hashing)
node main.js --headless --input "Movie.Name.2024.1080p.BluRay.x264-GRP.torrent"

# Build and submit in one shot (form mode needs an API token in config)
node main.js --headless --input "Movie.Name.2024.1080p.BluRay.x264-GRP" --submit

# Print help
node main.js --help
```

## Web UI (remote management)

The app includes an Express web UI so you can manage releases from a browser
instead of SSH. It runs on your assigned Ultra.cc 5-digit port, bound to
`127.0.0.1` only; terminate HTTPS + auth with Nginx
(see step 8 in Install).

### Features
- **File browser** — navigate the server filesystem (`[web] browse_root`, defaults to CWD) and select a release folder or `.torrent` to process.
- **Build torrent** — scan, hash, and build a private-flagged `.torrent` plus NFO/SFV/contact-sheet, with an option to submit to the tracker afterward.
- **Watch folder** — site-made `.torrent` files are saved to `[web] watch_folder` so your torrent client (rTorrent, qBittorrent, etc.) can auto-load them.
- **Jobs** — hashing large releases runs asynchronously; poll per-job progress and view logs.
- **Releases** — list previously built releases (`.release.json`) and re-submit them.
- **Config** — view masked config (secrets like the ImageBB key and API token are never exposed in plain text).

### Config (`[web]` section)

| Key | Meaning | Default |
|-----|---------|---------|
| `bind` | Bind address. Keep `127.0.0.1`; Nginx handles external access. | `127.0.0.1` |
| `port` | Your assigned Ultra.cc 5-digit port. Required; never a default port. | `0` (refuses to start) |
| `watch_folder` | Folder where built `.torrent` files are saved for auto-load. | `""` (beside source) |
| `max_concurrent_jobs` | Parallel build jobs (hashing is IO-heavy on seedboxes). | `1` |
| `job_retention_minutes` | How long finished job records stay in memory. | `60` |
| `browse_root` | Root the file browser may traverse. Blank => CWD. | `""` |

All `[web]` keys can be overridden via env vars, e.g. `ODFU_WEB_PORT=21345`.

### Security (defense in depth)

The web UI has **built-in authentication** (no Nginx required). On first run
without a password configured, a random password is auto-generated and saved
to `.auth`. You can also set `AUTH_USER` / `AUTH_PASS` env vars or configure
them in `config.toml`.

Nginx auth_basic is still supported as an additional layer for defense in
depth. The app adds its own guards:

| Layer | Config key | Default |
|-------|-----------|---------|
| IP allowlist | `ip_allowlist` | `["127.0.0.1", "::1"]` |
| HTTP Basic Auth | `auth_enabled` / `auth_username` / `auth_password` | enabled, empty creds (guard refuses to start) |
| CSRF tokens | (automatic) | required for POST/PUT/DELETE |
| Rate limiting | `rate_limit_max` / `rate_limit_window_seconds` | 60 req / 60s per IP |
| Security headers | (automatic) | CSP, X-Frame-Options, etc. |

Secrets (`auth_username`, `auth_password`) are stored as `SECRET_FIELDS` and
never exposed via `/api/config`. `web.js` refuses to bind unless `auth_enabled`
is false or both credentials are set.

### Nginx proxy (Ultra.cc) — optional

Nginx is optional since the app has built-in auth. Use it for HTTPS
termination and an extra auth layer. Create
`~/.apps/nginx/proxy.d/odfu-upload-helper.conf` (example; adjust the port
and username):

```nginx
location /app/ {
    proxy_pass http://127.0.0.1:21345/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    auth_basic "0dayfiles Upload Helper";
    auth_basic_user_file /home/USER/.htpasswd;
}
```
Then `~/.apps/nginx/nginx_proxy_reload`. Access via
`https://username.indigo.usbx.me/app/`.

### Flags

| Flag | Meaning |
|------|---------|
| `--headless` | Run without interactive prompts. Required for CLI/seedbox use. |
| `--input <path>` | Release folder **or** an existing `.torrent` (cross-seed). Required. |
| `--submit` | After building, submit to 0dayfiles.net (form mode) or write manual artifacts. |
| `--config <path>` | Explicit config path (defaults to `config.toml` in CWD). |

## Output

Artifacts are written to `<release>-output/` beside the source (or
`general.out_dir` from config):

- `<slug>.torrent` — the built (or cross-seeded) torrent
- `<slug>.nfo` — generated NFO, or copied from an existing one
- `<slug>.release.json` — full metadata dump
- `<slug>.submission.json` / `.submission.url.txt` — when `--submit` runs

## Config & secrets

Config resolution order:

1. `--config <path>` if given
2. `config.toml` in the working directory
3. Environment variable overrides: `ODFU_<SECTION>_<KEY>`

Example env overrides:
```bash
export ODFU_TORRENT_ANNOUNCE="https://0dayfiles.net/announce/KEY"
export ODFU_IMAGEBB_API_KEY="..."
export ODFU_TRACKER_API_TOKEN="..."
```

Secrets are **never written to logs**. The log only reports whether a value
is set and its length. `config.toml` is gitignored — use `config.toml.example`
as a template.

## What it does

| Step | Detail |
|------|--------|
| **Scan** | Walks the folder, sums sizes, natural-sorts filenames, probes MediaInfo, infers the tracker's category. |
| **Torrent** | Private-flagged `.torrent` with your announce URL + failover tiers. Multi-file pieces hashed as one continuous stream. Optional `.pad/N` pad files. |
| **NFO** | XML `<release>` / `<movie>` / `<tv>`. Reuses an existing `.nfo` if present. |
| **MediaInfo** | `mediainfo` CLI → `ffprobe` → extension fallback. Posts to the tracker's `mediainfo` field. |
| **BDInfo** | Reads `BDInfo_QuickSummary_*.txt` / `BDINFO_*.txt` and posts to `bdinfo`. |
| **Description** | Reads the publisher's blurb from container tags (web synopsis as fallback). |
| **Images** | Uploads screenshots to ImageBB (with Catbox/ImgCDN/HotIMG/imghosting/Freeimage fallback chain). `ffmpeg` captures video frames. Cover/banner attached as `.jpg`/`.jpeg` files. |
| **Submit** | Maps every field to the tracker's real form field names, runs a duplicate check (title search + content-hash), writes `.submission.json`, and (form mode) POSTs to `/api/torrents/upload`. |
| **Duplicate check** | Title search + content-hash dupe check before upload; exact dupes block the submit. |
| **Seeding folder** | Downloads the tracker's official `.torrent` after upload into a configurable folder. |
| **Auto-upload** | Optional toggle to submit automatically after a successful build (~30 req/min rate limit). |
| **Boost requests** | Ask staff for Freeleech / Double upload / Featured (10 asks per month). Staff decide; nothing changes until they act. |

## Systemd service (optional)

See `odfu-seedbox.service` for an example userland systemd unit:

```bash
mkdir -p ~/.config/systemd/user
cp odfu-seedbox.service ~/.config/systemd/user/odfu-upload-helper.service
# edit the ExecStart path, then:
systemctl --user daemon-reload
systemctl --user enable --now odfu-upload-helper.service
```

## License

MIT. See `LICENSE`.
