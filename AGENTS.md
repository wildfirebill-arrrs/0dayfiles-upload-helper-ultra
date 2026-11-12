# 0dayfiles upload helper — Ultra.cc seedbox edition (Node.js)

## Workflow

- On start, read `README.md`, `config.toml.example`, and `TODO.md`.
- After substantive progress, update docs and persist state.
- Never guess from model memory when docs might know: search first.

## Defaults (this project)

- Node.js >= 18 (NVM on Ultra.cc seedbox)
- `toml` + `bencode` npm dependencies (kept minimal)
- Native `fetch` / `FormData` (Node 18+) — no `node-fetch` needed
- MediaInfo/ffprobe/ffmpeg shell out (must be on PATH)
- TAP-compatible tests via `node --test`

## Verification

```sh
npm test
```

## Conventions

- CommonJS modules (`module.exports`, `require`)
- Type hints via JSDoc where public APIs cross module boundaries
- `pathlib`-equivalent: Node `path` / `fs/promises`
- No `process.nextTick`-style Node-isms in shared logic; keep it portable
- Tests mirror source layout (`tests/core/test_bencode.js`, etc.)
- Secrets via env vars only; never in logs

## Pitfalls

- No root/sudo on Ultra.cc — all installs in `$HOME`
- Only assigned 5-digit ports; never default ports
- `config.toml` is gitignored; copy from `config.toml.example`
- MediaInfo/ffmpeg/ffprobe binaries must be available on PATH
- Don't catch bare exceptions; catch specific errors
