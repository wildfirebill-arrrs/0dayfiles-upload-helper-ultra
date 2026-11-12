"use strict";

const fs = require("fs");
const path = require("path");

const SUMMARY_FILE_RE = /BDInfo_QuickSummary_.*\.txt$/i;
const FULL_RE = /BDINFO_.*\.txt$/i;

/**
 * Find a BDInfo file in a release folder.
 * Prefers BDInfo_QuickSummary_*.txt; falls back to full BDINFO_*.txt.
 * Returns { found, path, summaryText }.
 */
function findBdInfo(folder) {
  const entries = fs.readdirSync(folder);
  let quick = null;
  let full = null;
  for (const name of entries) {
    const fullPath = path.join(folder, name);
    if (!fs.statSync(fullPath).isFile()) continue;
    if (SUMMARY_FILE_RE.test(name)) quick = fullPath;
    else if (FULL_RE.test(name)) full = fullPath;
  }
  const target = quick || full;
  if (!target) return { found: false, path: null, summaryText: null };

  let text;
  try {
    text = fs.readFileSync(target, "utf8");
  } catch (_) {
    return { found: false, path: null, summaryText: null };
  }

  let summaryText = text;
  if (!SUMMARY_FILE_RE.test(path.basename(target))) {
    // Extract the summary block from a full report.
    const m = text.match(/[\s\S]*?(?=------------------------------)/);
    summaryText = m ? m[0] : text;
  }

  return { found: true, path: target, summaryText };
}

/** Extract key fields from a BDInfo summary text. */
function parseBdInfo(text) {
  const fields = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim();
    const lk = key.toLowerCase();
    if (lk === "movie title") fields.movieTitle = val;
    else if (lk === "film length") fields.filmLength = val;
    else if (lk === "disc size") fields.discSize = val;
    else if (lk === "video codec") fields.videoCodec = val;
    else if (lk === "video bitrate") fields.videoBitrate = val;
    else if (lk === "resolution") fields.resolution = val;
    else if (lk === "aspect ratio") fields.aspectRatio = val;
    else if (lk === "audio codec") fields.audioCodec = val;
    else if (lk === "audio bitrate") fields.audioBitrate = val;
    else if (lk === "audio channels") fields.audioChannels = val;
    else if (lk === "subtitles") fields.subtitles = val;
  }
  return fields;
}

module.exports = { findBdInfo, parseBdInfo, SUMMARY_FILE_RE, FULL_RE };
