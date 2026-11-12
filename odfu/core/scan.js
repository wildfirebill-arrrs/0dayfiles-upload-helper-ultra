"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Scan a release folder: measure size, list files, natural-sort names,
 * record extensions. Does NOT hash (that's torrent.js).
 */
async function scanRelease(release, { log } = {}) {
  const source = release.sourceDir;
  if (!source || !fs.existsSync(source)) {
    throw new Error(`source folder does not exist: ${source}`);
  }

  release.state = "scanning";
  release.note("scan started");

  let totalSize = 0;
  let fileCount = 0;
  const extensions = new Set();
  const files = [];

  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(source, entry.name);
    if (entry.isDirectory()) continue;
    const stat = fs.statSync(full);
    totalSize += stat.size;
    fileCount++;
    const ext = path.extname(entry.name).toLowerCase().replace(/^\./, "");
    if (ext) extensions.add(ext);
    files.push({ name: entry.name, size: stat.size, ext, path: full });
  }

  // Natural sort: s2 before s10.
  files.sort((a, b) => naturalCompare(a.name, b.name));

  release.totalSize = totalSize;
  release.fileCount = fileCount;
  release.extensions = [...extensions].sort();
  release.note(`scanned ${fileCount} files, ${release.sizeHuman}`);

  if (log) log(`scanned ${fileCount} files (${release.sizeHuman})`);
  return release;
}

/** Natural string comparison (s2 < s10). */
function naturalCompare(a, b) {
  const chunkRegex = /(\d+)|(\D+)/g;
  const ta = a.match(chunkRegex) || [];
  const tb = b.match(chunkRegex) || [];
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i] || "";
    const y = tb[i] || "";
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff) return diff;
    } else {
      const c = x.localeCompare(y, undefined, { numeric: false, sensitivity: "base" });
      if (c) return c;
    }
  }
  return 0;
}

module.exports = { scanRelease, naturalCompare };
