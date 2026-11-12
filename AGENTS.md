# 0dayfiles upload helper — Ultra.cc seedbox edition (Node.js)

Public repo: https://github.com/wildfirebill-arrrs/0dayfiles-upload-helper-ultra
Remote: `origin` → `https://github.com/wildfirebill-arrrs/0dayfiles-upload-helper-ultra.git`

## Workflow

- On start, read `README.md`, `config.toml.example`, and `TODO.md`.
- After substantive progress, update docs and persist state.
- Never guess from model memory when docs might know: search first.

## Defaults (this project)

- Node.js >= 18 (NVM on Ultra.cc seedbox)
- `toml` + `bencode` + `express` npm dependencies (kept minimal)
- Native `fetch` / `FormData` (Node 18+) — no `node-fetch` needed
- MediaInfo/ffprobe/ffmpeg shell out (must be on PATH)
- TAP-compatible tests via `node --test`

## Scripts

- `npm start` / `node main.js` — headless CLI (`--headless --input <path>`)
- `npm run web` / `node web.js` — Express web UI (requires `[web] port` set to an assigned 5-digit port; binds `127.0.0.1` only)
- `npm test` — TAP tests via `node --test` (mirrors source layout: `tests/core/`, `tests/web/`)

## Conventions

- CommonJS modules (`module.exports`, `require`)
- Type hints via JSDoc where public APIs cross module boundaries
- `pathlib`-equivalent: Node `path` / `fs/promises`
- No `process.nextTick`-style Node-isms in shared logic; keep it portable
- Secrets via env vars only; never in logs

## Pitfalls

- No root/sudo on Ultra.cc — all installs in `$HOME`
- Only assigned 5-digit ports; never default ports (80/443/3000/8080)
- `config.toml` is gitignored; copy from `config.toml.example`
- MediaInfo/ffmpeg/ffprobe binaries must be available on PATH
- Don't catch bare exceptions; catch specific errors
- Web UI binds `127.0.0.1` only; Nginx (`~/.apps/nginx/proxy.d/`) terminates HTTPS/auth. Do not expose the Express port directly.
- `web.port` must be set to your assigned 5-digit Ultra.cc port; `web.js` refuses to start otherwise.
- `/api/browse` is read-only and confined to `web.browse_root` (default CWD) with path-traversal guards.
