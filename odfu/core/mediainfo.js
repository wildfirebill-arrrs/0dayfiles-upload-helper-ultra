"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const VIDEO_EXTS = new Set(["mkv", "mp4", "avi", "mov", "wmv", "flv", "ts", "m2ts", "iso", "vob"]);
const AUDIO_EXTS = new Set(["mp3", "m4b", "m4a", "flac", "wav", "ogg", "wma", "aac"]);

const MAX_FILES = 64;

/**
 * Probe a single file with mediainfo CLI, ffprobe, or extension fallback.
 * Returns { available, rawReport, toData, files, error }.
 */
async function probeFile(filePath, mediainfoCliPath = "") {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");

  // Try mediainfo CLI first.
  if (mediainfoCliPath) {
    try {
      const { stdout } = await execFileAsync(mediainfoCliPath, ["--Full", filePath], {
        timeout: 30000,
        encoding: "utf8",
      });
      return buildResult(true, stdout, filePath, ext);
    } catch (_) {
      // fall through to ffprobe
    }
  } else {
    // auto-detect mediainfo on PATH
    try {
      const { stdout } = await execFileAsync("mediainfo", ["--Full", filePath], {
        timeout: 30000,
        encoding: "utf8",
      });
      return buildResult(true, stdout, filePath, ext);
    } catch (_) {
      // fall through
    }
  }

  // Try ffprobe.
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath],
      { timeout: 30000, encoding: "utf8" }
    );
    return buildResult(true, stdout, filePath, ext, "ffprobe");
  } catch (_) {
    // fall through to extension fallback
  }

  // Extension fallback: synthesize a minimal report.
  return buildResult(false, null, filePath, ext, "extension");
}

function buildResult(available, rawReport, filePath, ext, source = "mediainfo") {
  let data = {};
  if (source === "ffprobe" && rawReport) {
    try {
      data = JSON.parse(rawReport);
    } catch (_) {
      data = {};
    }
  }

  const result = {
    available,
    source,
    rawReport: available ? String(rawReport || "") : "",
    filePath,
    ext,
    format: null,
    streams: [],
    durationMs: 0,
    durationSeconds: 0,
    size: 0,
    width: 0,
    height: 0,
    codec: "",
    container: "",
  };

  if (source === "mediainfo" && rawReport) {
    parseMediainfoText(result, rawReport);
  } else if (source === "ffprobe" && data.format) {
    result.format = data.format;
    result.streams = data.streams || [];
    result.durationMs = Number(data.format.duration || 0) * 1000;
    result.durationSeconds = Number(data.format.duration || 0);
    result.size = Number(data.format.size || 0);
    const videoStream = result.streams.find((s) => s.codec_type === "video");
    if (videoStream) {
      result.width = videoStream.width || 0;
      result.height = videoStream.height || 0;
      result.codec = videoStream.codec_name || "";
    }
    result.container = data.format.format_name || "";
    result.codec = result.codec || "";
  }

  return result;
}

function parseMediainfoText(result, text) {
  const lines = text.split(/\r?\n/);
  let currentSection = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("General") || trimmed.startsWith("Video") ||
        trimmed.startsWith("Audio") || trimmed.startsWith("Text") ||
        trimmed.startsWith("Menu")) {
      currentSection = trimmed.split(" ")[0];
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim();
    const lk = key.toLowerCase();

    if (lk === "unique id") result.infohash = val;
    else if (lk === "complete name") result.completeName = val;
    else if (lk === "format") {
      if (currentSection === "General") result.container = val;
    }
    else if (lk === "format profile") result.profile = val;
    else if (lk === "codec id") result.codecId = val;
    else if (lk === "duration") result.durationMs = parseDurationMs(val);
    else if (lk === "overall bit rate") result.bitRate = val;
    else if (lk === "width") result.width = parseInt(val, 10) || 0;
    else if (lk === "height") result.height = parseInt(val, 10) || 0;
    else if (lk === "display aspect ratio") result.aspectRatio = val;
    else if (lk === "frame rate") result.frameRate = val;
    else if (lk === "title") result.title = val;
    else if (lk === "encoded date") result.encodedDate = val;
    else if (lk === "tagged date") result.taggedDate = val;
    else if (lk === "writing library") result.writingLibrary = val;
    else if (lk === "language") {
      if (currentSection === "General") result.language = val;
    }
    else if (lk === "title_more" || lk === "title more") result.titleMore = val;
    else if (lk === "track_more" || lk === "track more") result.trackMore = val;
    else if (lk === "comment") result.comment = val;
  }
  result.durationSeconds = result.durationMs / 1000;
}

function parseDurationMs(str) {
  if (!str) return 0;
  // MediaInfo duration like "1 h 23 mn" or "1h23mn45s" or "123456 ms"
  let ms = 0;
  const h = str.match(/(\d+)\s*h/i);
  if (h) ms += Number(h[1]) * 3600000;
  const m = str.match(/(\d+)\s*m(?![s])/i);
  if (m) ms += Number(m[1]) * 60000;
  const s = str.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (s) ms += Number(s[1]) * 1000;
  const direct = str.match(/^(\d+)\s*ms$/i);
  if (direct) ms += Number(direct[1]);
  return ms;
}

/**
 * Probe every media file in a release folder (capped at MAX_FILES).
 * Returns { available, files: MediaInfoResult[], headline, error }.
 */
async function probeFolder(folder, mediainfoCliPath = "", maxFiles = MAX_FILES) {
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const mediaFiles = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase().replace(/^\./, "");
    if (VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) {
      mediaFiles.push(path.join(folder, entry.name));
    }
  }
  mediaFiles.sort();

  const results = [];
  for (const filePath of mediaFiles.slice(0, maxFiles)) {
    try {
      const r = await probeFile(filePath, mediainfoCliPath);
      results.push(r);
    } catch (_) {
      // skip unprobeable files
    }
  }

  const available = results.some((r) => r.available);
  const headline = results.length ? results[0] : null;

  return { available, files: results, headline, count: results.length };
}

module.exports = { probeFile, probeFolder, buildResult, parseDurationMs, VIDEO_EXTS, AUDIO_EXTS };
