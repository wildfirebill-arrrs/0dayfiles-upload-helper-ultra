"use strict";

/*!
 * Release-name parsing for 0dayfiles upload helper.
 *
 * Splits scene dot-runs (e.g. "Dune.2021.2160p.BluRay.REMUX-GRP") from
 * human book names (e.g. "Alex Kava - Before Evil (2000)") into title,
 * author, series, number, and year.
 *
 * A scene name is one unbroken dot-run, so a dash with a space on each
 * side is a book separator; a parenthesised group is a scene qualifier
 * and a year to a human.
 */

const YEAR_RE = /(?:^|[ ._])((?:19|20)\d{2})(?:[ ._].*)?$/;
const PAREN_YEAR_RE = /\(((?:19|20)\d{2})\)/;
const PART_RE = /(?:^|[ ._])(CD\d+|Part\s*\d+|Disc\s*\d+|#\d+)(?:[ ._].*)?$/i;
const EDITION_RE = /(?:director.?s cut|extended|kino|theatrical|ultimate|definitive|collector.?s|special edition|workprint|assembly|restored|criterion|anniversary|remastered|uncut|uncensored|red band|digital|streaming|web-dl|webrip|bluray|brrip|bdrip|dvdrip|dvdscr|hdtv|web|hdrip|hd|full hd|uhd|4k|2160p|1080p|720p|1080i|x264|x265|hevc|av1|aac|ac3|dts|truehd|flac|mp3|retail|internal|limited|proper|rerip|repack|unrated|directors|cut|extended|limited|proper|rerip|repack|unrated|uncut|uncensored)/i;

const NOISE_TOKENS = [
  "720p", "1080p", "1080i", "2160p", "4k", "uhd", "hd", "full hd",
  "x264", "x265", "hevc", "av1", "xvid", "divx",
  "aac", "ac3", "dts", "truehd", "flac", "mp3", "dd5.1", "dd2.0",
  "bluray", "brrip", "bdrip", "dvdrip", "dvdscr", "hdtv", "webrip", "web-dl", "webrip",
  "retail", "internal", "limited", "proper", "rerip", "repack", "unrated",
  "uncut", "uncensored", "directors", "directors cut", "director's cut",
  "extended", "theatrical", "ultimate", "definitive", "collector's",
  "special edition", "workprint", "assembly", "restored", "criterion",
  "anniversary", "remastered", "red band", "digital", "streaming",
  "dvd", "dvd9", "dvd5", "cd1", "cd2", "disc", "disc1", "disc2",
  "part1", "part2", "part 1", "part 2", "pt1", "pt2",
  "mkv", "mp4", "avi", "mov", "wmv", "flv", "ts", "m2ts", "iso",
  "mp3", "m4b", "m4a", "flac", "wav", "ogg", "wma", "aac",
  "epub", "pdf", "mobi", "azw3", "azw", "txt", "rtf", "doc", "docx",
  "cbr", "cbz", "rar", "zip", "7z", "tar", "gz", "xci", "nsp", "nsz", "nsw", "xcz",
  "grp", "internal", "limited",
];

/** Normalize whitespace/dots to single spaces, trim. */
function normalize(text) {
  return (text || "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip trailing edition/release noise tokens from a title. */
function stripNoise(title) {
  let t = normalize(title);
  let changed = true;
  while (changed) {
    changed = false;
    const lower = t.toLowerCase();
    for (const token of NOISE_TOKENS) {
      const pattern = new RegExp(`(?:[ ._])(${escapeRegExp(token)})$`, "i");
      if (pattern.test(lower)) {
        t = t.replace(pattern, "").trim();
        changed = true;
        break;
      }
    }
  }
  return t;
}

/** Escape a string for use in a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract the last plausible year from text (not part of a larger number). */
function extractYear(text) {
  const m = text.match(PAREN_YEAR_RE);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 1900 && y <= new Date().getFullYear() + 1) return String(y);
  }
  const m2 = text.match(YEAR_RE);
  if (m2) {
    const y = parseInt(m2[1], 10);
    if (y >= 1900 && y <= new Date().getFullYear() + 1) return String(y);
  }
  return "";
}

/** Detect if a name is a scene dot-run (one unbroken run of dot-separated tokens). */
function isSceneName(name) {
  // Scene names are dot-separated with no spaces between tokens.
  return /\.[A-Za-z0-9]/.test(name) && !/\s/.test(name);
}

/**
 * Parse a release name into structured fields.
 * Returns { title, author, series, seriesNumber, number, year, kind, raw }.
 */
function parseReleaseName(text) {
  const raw = text || "";
  const trimmed = raw.trim();
  let title = "";
  let author = "";
  let series = "";
  let seriesNumber = "";
  let number = "";
  let year = "";

  // Scene dot-run: split on dots, strip noise, extract year.
  if (isSceneName(trimmed)) {
    const tokens = trimmed.split(".");
    const yearTok = tokens.find((t) => /^(?:19|20)\d{2}$/.test(t));
    if (yearTok) {
      year = yearTok;
      tokens.splice(tokens.indexOf(yearTok), 1);
    }
    const noiseTokens = new Set(NOISE_TOKENS.map((t) => t.toLowerCase()));
    const titleTokens = tokens.filter(
      (t) => !noiseTokens.has(t.toLowerCase()) && !/^(?:CD|DVD|DISC|PART|DISC)\d?$/i.test(t)
    );
    title = normalize(titleTokens.join(" "));
    return { title, author, series, seriesNumber, number, year, kind: "scene", raw };
  }

  // Human-readable name: split on " - " (book separator).
  const dashParts = trimmed.split(/\s+-\s+/);
  if (dashParts.length >= 2) {
    author = normalize(dashParts[0]);
    const rest = dashParts.slice(1).join(" - ");
    year = extractYear(rest);
    title = stripNoise(rest.replace(PAREN_YEAR_RE, "").trim());
    // Detect "Series N." or "Series #N".
    const seriesMatch = title.match(/^(.*?)\s*(?:\.|)\s*#?(\d+)(?:\s|$)/);
    if (seriesMatch && seriesMatch[2]) {
      series = normalize(seriesMatch[1]);
      number = seriesMatch[2];
      title = normalize(title.replace(seriesMatch[0], "").trim());
    }
    return { title, author, series, seriesNumber, number, year, kind: "human", raw };
  }

  // Fallback: single name, extract year, strip noise.
  year = extractYear(trimmed);
  title = stripNoise(trimmed.replace(PAREN_YEAR_RE, "").trim());
  return { title, author, series, seriesNumber, number, year, kind: "unknown", raw };
}

module.exports = { parseReleaseName, normalize, stripNoise, extractYear, isSceneName, NOISE_TOKENS };
