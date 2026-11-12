"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function uuid4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (crypto.randomBytes(1)[0] % 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const mi = require("./mediainfo");
const cats = require("./categories");
const nfoMod = require("./nfo");
const tracker = require("./tracker");

const StepState = {
  PENDING: "pending",
  SCANNING: "scanning",
  PROBING: "probing",
  BUILDING: "building",
  DONE: "done",
  ERROR: "error",
};

/** Slugify a release title for output filenames. */
function slug(text) {
  return String(text || "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/[-._]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    || "release";
}

/**
 * Release — all mutable state for one release being prepared.
 */
class Release {
  constructor({ sourceDir, sourceTorrent = null, crossSeed = false, sourceAnnounce = "",
                sourceAnnounceTiers = [], outputDir = null } = {}) {
    this.sourceDir = sourceDir;
    this.sourceTorrent = sourceTorrent;
    this.crossSeed = crossSeed;
    this.sourceAnnounce = sourceAnnounce;
    this.sourceAnnounceTiers = sourceAnnounceTiers;
    this.outputDir = outputDir;

    // UUID so two releases queued in the same millisecond don't collide.
    this.id = uuid4();
    this.createdAt = new Date().toISOString();

    this.totalSize = 0;
    this.fileCount = 0;
    this.extensions = [];
    this.media = { available: false };

    this.title = "";
    this.description = "";
    this.keywords = "";
    this.category = "";
    this.categoryId = 0;
    this.season = "";
    this.episode = "";
    this.author = "";
    this.series = "";
    this.seriesNumber = "";
    this.descriptionAuto = false;
    this.synopsisSource = "";
    this.synopsisUrl = "";
    this.mediaInfoText = "";
    this.bdinfo = "";
    this.anon = false;
    this.personalRelease = false;

    this.tmdbMovieId = "";
    this.tmdbTvId = "";
    this.tmdbCollectionId = "";
    this.tvdbId = "";
    this.igdbId = "";
    this.imdbId = "";
    this.musicbrainzId = "";

    this.group = "";
    this.format = "";
    this.medium = "";
    this.codec = "";
    this.container = "";
    this.releaseType = "";
    this.scene = false;
    this.year = "";

    this.coverPath = "";
    this.bannerPath = "";
    this.dupeReason = "";
    this.dupeNote = "";
    this.nfoExtension = ".nfo";

    // Boost-request fields (0dayfiles.net UNIT3D form, 10 asks per month).
    this.boostAsk = false;
    this.boostFree = 0;
    this.boostFreeDays = 0;
    this.boostDuDays = 0;
    this.boostFeatured = false;
    this.boostReason = "";

    this.torrentPath = null;
    this.nfoPath = null;
    this.infohash = "";
    this.pieceLength = 0;
    this.padBytes = 0;
    this.torrentSeconds = 0;
    this.images = [];
    this.submission = null;

    this.state = StepState.PENDING;
    this.error = "";
    this.history = [];
  }

  get mediaInfoText() {
    return this._mediaInfoText || (this.media.available ? this.media.rawReport : "");
  }
  set mediaInfoText(v) {
    this._mediaInfoText = v || "";
  }

  get categoryLabel() {
    const found = cats.byId(this.categoryId) || cats.byLabel(this.category || "");
    return found ? found.label : (this.category || "");
  }

  get sizeHuman() {
    return nfoMod.humanSize(this.totalSize);
  }

  get displayName() {
    return this.title || (this.sourceDir ? path.basename(this.sourceDir) : "");
  }

  status() {
    if (this.error) return `error: ${this.error}`;
    if (this.state === StepState.DONE) return "ready";
    return this.state;
  }

  toDict() {
    return {
      id: this.id,
      sourceDir: String(this.sourceDir),
      outputDir: String(this.outputDir || ""),
      title: this.displayName,
      size: this.totalSize,
      sizeHuman: this.sizeHuman,
      fileCount: this.fileCount,
      extensions: this.extensions,
      categoryId: this.categoryId,
      category: this.categoryLabel,
      keywords: this.keywords,
      season: this.season,
      episode: this.episode,
      tmdbMovieId: this.tmdbMovieId,
      tmdbTvId: this.tmdbTvId,
      tmdbCollectionId: this.tmdbCollectionId,
      tvdbId: this.tvdbId,
      igdbId: this.igdbId,
      imdbId: this.imdbId,
      musicbrainzId: this.musicbrainzId,
      anon: this.anon,
      personalRelease: this.personalRelease,
      infohash: this.infohash,
      torrentPath: String(this.torrentPath || ""),
      nfoPath: String(this.nfoPath || ""),
      coverPath: this.coverPath,
      bannerPath: this.bannerPath,
      pieceLength: this.pieceLength,
      padBytes: this.padBytes,
      scene: this.scene,
      images: this.images.map((img) => img.displayUrl),
      mediaInfo: this.media.toDict ? this.media.toDict() : {},
      state: this.state,
      error: this.error,
      createdAt: this.createdAt,
      boostAsk: this.boostAsk,
      boostFree: this.boostFree,
      boostFreeDays: this.boostFreeDays,
      boostDuDays: this.boostDuDays,
      boostFeatured: this.boostFeatured,
      boostReason: this.boostReason,
    };
  }

  exportJson() {
    const target = path.join(
      this.outputDir || this.sourceDir,
      `${slug(this.displayName)}.release.json`
    );
    fs.writeFileSync(target, JSON.stringify(this.toDict(), null, 2), "utf8");
    return target;
  }

  note(message) {
    const stamped = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
    this.history.push(stamped);
  }
}

module.exports = { Release, StepState, slug };
