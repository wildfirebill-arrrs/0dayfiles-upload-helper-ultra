"use strict";

/*!
 * Category inference for 0dayfiles.net (UNIT3D).
 *
 * All 40 tracker categories with labels, types, and inference rules.
 * Inference is driven by the release's file extensions and parsed name.
 */

// [id, label, type, pack?, extensions[], keywords[]]
// type: movie | tv | audiobook | music | game | software | book | xxx | other
const CATEGORIES = [
  [1, "Movies", "movie", false],
  [2, "Movie Packs", "movie", true],
  [3, "Movies / XXX", "xxx", false],
  [4, "Movies / XXX Packs", "xxx", true],
  [5, "Movies / Foreign", "movie", false],
  [6, "Movies / Foreign Packs", "movie", true],
  [7, "Movies / Documentary", "movie", false],
  [8, "Movies / Documentary Packs", "movie", true],
  [9, "Movies / Animation", "movie", false],
  [10, "Movies / Animation Packs", "movie", true],
  [11, "TV", "tv", false],
  [12, "TV Packs", "tv", true],
  [13, "TV / XXX", "xxx", false],
  [14, "TV / XXX Packs", "xxx", true],
  [15, "TV / Foreign", "tv", false],
  [16, "TV / Foreign Packs", "tv", true],
  [17, "TV / Documentary", "tv", false],
  [18, "TV / Documentary Packs", "tv", true],
  [19, "TV / Animation", "tv", false],
  [20, "TV / Animation Packs", "tv", true],
  [21, "Music", "music", false],
  [22, "Music / XXX", "xxx", false],
  [23, "Music Packs", "music", true],
  [24, "Music / Audio Books", "audiobook", false],
  [25, "Music / Audio Books Packs", "audiobook", true],
  [26, "Books", "book", false],
  [27, "Books / XXX", "xxx", false],
  [28, "Books Packs", "book", true],
  [29, "Comics", "book", false],
  [30, "Comics Packs", "book", true],
  [31, "Games", "game", false],
  [32, "Game Packs", "game", true],
  [33, "Games / XXX", "xxx", false],
  [34, "Software", "software", false],
  [35, "Software Packs", "software", true],
  [36, "Software / XXX", "xxx", false],
  [37, "Other", "other", false],
  [38, "Other Packs", "other", true],
  [39, "Other / XXX", "xxx", false],
  [40, "Other / XXX Packs", "xxx", true],
];

const EXT_VIDEO = new Set(["mkv", "mp4", "avi", "mov", "wmv", "flv", "ts", "m2ts", "iso", "vob"]);
const EXT_AUDIO = new Set(["mp3", "m4b", "m4a", "flac", "wav", "ogg", "wma", "aac"]);
const EXT_BOOK = new Set(["epub", "pdf", "mobi", "azw3", "azw", "txt", "rtf", "doc", "docx"]);
const EXT_GAME = new Set(["xci", "nsp", "nsz", "nsw", "xcz", "iso", "bin", "cue"]);
const EXT_IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "nfo", "sfv", "txt"]);

/** Lookup category by numeric id. */
function byId(id) {
  const row = CATEGORIES.find((r) => r[0] === id);
  if (!row) return null;
  return { id: row[0], label: row[1], type: row[2], pack: !!row[3] };
}

/** Lookup category by label (case-insensitive). */
function byLabel(label) {
  const row = CATEGORIES.find((r) => r[1].toLowerCase() === String(label || "").toLowerCase());
  if (!row) return null;
  return { id: row[0], label: row[1], type: row[2], pack: !!row[3] };
}

/**
 * Infer the best category for a release.
 *
 * @param {Object} release - { extensions: string[], title?: string, category?: string }
 * @returns {Object|null} { id, label, type, pack }
 */
function infer(release) {
  const exts = (release.extensions || []).map((e) => String(e).toLowerCase().replace(/^\./, ""));
  const hasVideo = exts.some((e) => EXT_VIDEO.has(e));
  const hasAudio = exts.some((e) => EXT_AUDIO.has(e));
  const hasBook = exts.some((e) => EXT_BOOK.has(e));
  const hasGame = exts.some((e) => EXT_GAME.has(e));
  const hasOnlyNonMedia = exts.every((e) => !EXT_VIDEO.has(e) && !EXT_AUDIO.has(e) && !EXT_BOOK.has(e) && !EXT_GAME.has(e));

  const parsed = release.parsed || {};
  const titleLower = String(release.title || "").toLowerCase();
  const rawLower = String(release.raw || "").toLowerCase();

  const audiobookKeywords = ["audiobook", "audio book", "mp3", "m4b", "m4a"];
  const isAudiobook = hasAudio &&
    (audiobookKeywords.some((k) => titleLower.includes(k) || rawLower.includes(k)) ||
      exts.some((e) => ["m4b"].includes(e)));

  // Explicit category override (e.g. user set it).
  if (release.category) {
    const existing = byLabel(release.category);
    if (existing) return existing;
  }

  // Game detection.
  if (hasGame) return byId(31); // Games

  // Software detection (executables, installers).
  if (hasOnlyNonMedia && exts.some((e) => ["exe", "msi", "dmg", "pkg", "app", "deb", "rpm"].includes(e))) {
    return byId(34); // Software
  }

  // Book / comic detection.
  if (hasBook && !hasVideo && !hasAudio) {
    return parsed.kind === "scene" ? byId(26) : byId(26); // Books
  }

  // Music / audiobook.
  if (hasAudio && !hasVideo) {
    if (isAudiobook) return byId(24); // Music / Audio Books
    return byId(21); // Music
  }

  // Video: movie vs TV.
  if (hasVideo) {
    const parsedYear = parsed.year || release.year || "";
    const season = release.season || parsed.seriesNumber || "";
    const episode = release.episode || parsed.number || "";
    const isTV = !!(season || episode) ||
      /s\d{1,2}[eE]\d{1,2}|season|episode/i.test(rawLower) ||
      /s\d{1,2}/i.test(titleLower);
    if (isTV) return byId(11); // TV
    return byId(1); // Movies
  }

  // Audio-only with no clear markers -> music.
  if (hasAudio) return byId(21);

  // Default fallback.
  return byId(37); // Other
}

module.exports = { CATEGORIES, byId, byLabel, infer };
