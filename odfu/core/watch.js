"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

/**
 * Resolve the configured watch folder.
 *
 * Resolution order:
 *  1. cfg.web.watch_folder if non-empty
 *  2. cfg.general.out_dir if non-empty
 *  3. null (caller falls back to <release>-output beside the source)
 *
 * @param {Object} cfg - loaded config object (cfg.web, cfg.general)
 * @returns {string|null} absolute watch folder path, or null if unset
 */
function resolveWatchFolder(cfg) {
  const webDir = String(cfg.web && cfg.web.watch_folder || "").trim();
  if (webDir) return path.resolve(webDir);
  const outDir = String(cfg.general && cfg.general.out_dir || "").trim();
  if (outDir) return path.resolve(outDir);
  return null;
}

/** Ensure the watch folder exists (recursive mkdir). */
function ensureWatchFolderSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Ensure the watch folder exists (async). */
async function ensureWatchFolder(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Copy a built .torrent into the watch folder so a torrent client can auto-load it.
 * Overwrites an existing same-named file (clients re-pick on mtime change).
 *
 * @param {string} torrentPath - absolute path to the built .torrent
 * @param {string} watchDir - absolute watch folder path
 * @param {Object} [opts] - { log } optional logger
 * @returns {string|null} absolute path of the saved copy, or null if watch dir unset
 */
function saveTorrentToWatchFolder(torrentPath, watchDir, { log } = {}) {
  if (!watchDir) {
    if (log) log("watch folder not configured; skipping save to watch folder");
    return null;
  }
  ensureWatchFolderSync(watchDir);
  const dest = path.join(watchDir, path.basename(torrentPath));
  fs.copyFileSync(torrentPath, dest);
  if (log) log(`torrent saved to watch folder: ${dest}`);
  return dest;
}

module.exports = {
  resolveWatchFolder,
  ensureWatchFolder,
  ensureWatchFolderSync,
  saveTorrentToWatchFolder,
};
