"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

/** CRC32 implementation (used for .sfv). */
const CRC_TABLE = (() => {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

/**
 * Generate an .sfv file for a release folder.
 * Returns the written .sfv path.
 */
async function generateSfv(release) {
  const source = release.sourceDir;
  const ext = release.nfoExtension || ".nfo";
  const entries = fs.readdirSync(source, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(source, entry.name);
    if (path.extname(entry.name).toLowerCase() === ext) continue; // skip nfo
    files.push(full);
  }
  files.sort();

  const lines = [];
  for (const file of files) {
    const stat = fs.statSync(file);
    const buf = fs.readFileSync(file);
    const crc = crc32(buf);
    lines.push(`${path.basename(file)} ${crc}`);
  }

  const sfvName = `${path.basename(source)}.sfv`;
  const sfvPath = path.join(source, sfvName);
  fs.writeFileSync(sfvPath, lines.join("\n") + "\n", "utf8");
  release.note(`SFV written: ${sfvName} (${files.length} files)`);
  return sfvPath;
}

/** Verify an .sfv against current files. Returns { ok, mismatches: [] }. */
function verifySfv(sfvPath) {
  const content = fs.readFileSync(sfvPath, "utf8");
  const dir = path.dirname(sfvPath);
  const mismatches = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const name = parts[0];
    const expected = parts[1].toUpperCase();
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) {
      mismatches.push({ name, reason: "missing" });
      continue;
    }
    const actual = crc32(fs.readFileSync(full));
    if (actual !== expected) mismatches.push({ name, expected, actual });
  }
  return { ok: mismatches.length === 0, mismatches };
}

module.exports = { generateSfv, verifySfv, crc32 };
