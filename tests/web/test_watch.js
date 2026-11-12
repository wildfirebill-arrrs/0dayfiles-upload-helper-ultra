"use strict";

// TAP test for odfu/core/watch.js via node --test
const assert = require("node:assert");
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fsp = require("fs/promises");

const {
  resolveWatchFolder,
  ensureWatchFolder,
  ensureWatchFolderSync,
  saveTorrentToWatchFolder,
} = require("../../odfu/core/watch");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "odfu-watch-test-"));

function cfgWith(watchFolder) {
  return { web: { watch_folder: watchFolder || "" }, general: { out_dir: "" } };
}

test.after(() => fsp.rm(TMP, { recursive: true, force: true }));

test("resolveWatchFolder prefers web.watch_folder", () => {
  const dir = path.join(TMP, "watch");
  assert.strictEqual(resolveWatchFolder(cfgWith(dir)), path.resolve(dir));
});

test("resolveWatchFolder falls back to general.out_dir", () => {
  const dir = path.join(TMP, "out");
  const cfg = cfgWith("");
  cfg.general.out_dir = dir;
  assert.strictEqual(resolveWatchFolder(cfg), path.resolve(dir));
});

test("resolveWatchFolder returns null when unset", () => {
  assert.strictEqual(resolveWatchFolder(cfgWith("")), null);
});

test("ensureWatchFolderSync creates the directory", () => {
  const dir = path.join(TMP, "sync-created");
  assert.strictEqual(fs.existsSync(dir), false);
  ensureWatchFolderSync(dir);
  assert.strictEqual(fs.existsSync(dir), true);
  assert.strictEqual(fs.statSync(dir).isDirectory(), true);
});

test("ensureWatchFolder (async) creates the directory", async () => {
  const dir = path.join(TMP, "async-created");
  assert.strictEqual(fs.existsSync(dir), false);
  const res = await ensureWatchFolder(dir);
  assert.strictEqual(res, path.resolve(dir));
  assert.strictEqual(fs.existsSync(dir), true);
});

test("saveTorrentToWatchFolder copies the torrent", async () => {
  const src = path.join(TMP, "release.torrent");
  await fsp.writeFile(src, Buffer.from("d8:announce13:http://example.com/announceee", "utf8"));
  const watchDir = path.join(TMP, "watch");
  const saved = saveTorrentToWatchFolder(src, watchDir, { log: () => {} });
  assert.strictEqual(saved, path.join(watchDir, "release.torrent"));
  assert.strictEqual(fs.existsSync(saved), true);
  const content = await fsp.readFile(saved, "utf8");
  assert.strictEqual(content, "d8:announce13:http://example.com/announceee");
});

test("saveTorrentToWatchFolder returns null when watchDir unset", () => {
  const src = path.join(TMP, "release.torrent");
  assert.strictEqual(saveTorrentToWatchFolder(src, null, { log: () => {} }), null);
});
