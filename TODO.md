# TODO — 0dayfiles upload helper (Ultra.cc seedbox edition, Node.js)

## Next

- [ ] Add tests for bencode.js, naming.js, categories.js, torrent.js
- [ ] Wire ffprobe/mediainfo availability check at startup
- [ ] Add config validation (required fields: announce, ImageBB key)
- [ ] Add rate-limit persistence across restarts
- [ ] Test cross-seed path against a real .torrent
- [ ] Document Nginx HTTPS proxy setup (~/.apps/nginx/proxy.d/)
- [ ] Web UI on an assigned Ultra.cc port (Express): odfu/web/server.js + web.js entry point
- [ ] File browser: navigate server filesystem, select release folder or .torrent
- [ ] Customizable watch folder: site-made .torrent saved for torrent-client auto-load
- [ ] Async build jobs with jobId polling (hashing is slow; max_concurrent_jobs guard)
- [ ] Security: bind 127.0.0.1, path-traversal guard on /api/browse, secrets masked

## Could be useful

- [ ] Persist per-release metadata between runs (half-finished release)
- [ ] Import existing .torrent and suggest announce-list
- [ ] Batch import: read a folder of release subfolders
- [ ] Add a simple interactive TUI mode (optional, for non-headless use)

## Deliberately out of scope

- GUI (PyQt) — this is the headless seedbox edition
- Seeding-client launch (official .torrent downloaded for manual seeding)
