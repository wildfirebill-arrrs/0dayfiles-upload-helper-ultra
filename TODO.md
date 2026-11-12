# TODO — 0dayfiles upload helper (Ultra.cc seedbox edition, Node.js)

## Next

- [ ] Add tests for bencode.js, naming.js, categories.js, torrent.js
- [ ] Wire ffprobe/mediainfo availability check at startup
- [ ] Add a simple interactive TUI mode (optional, for non-headless use)
- [ ] Add config validation (required fields: announce, ImageBB key)
- [ ] Add rate-limit persistence across restarts
- [ ] Test cross-seed path against a real .torrent
- [ ] Document Nginx HTTPS proxy setup (~/.apps/nginx/proxy.d/)

## Could be useful

- [ ] Web UI on an assigned Ultra.cc port (Express) for remote management
- [ ] Persist per-release metadata between runs (half-finished release)
- [ ] Import existing .torrent and suggest announce-list
- [ ] Batch import: read a folder of release subfolders

## Deliberately out of scope

- GUI (PyQt) — this is the headless seedbox edition
- Seeding-client launch (official .torrent downloaded for manual seeding)
