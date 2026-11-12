#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { load, configPath } = require("./odfu/core/config");
const { Release, StepState, slug } = require("./odfu/core/pipeline");
const { scanRelease } = require("./odfu/core/scan");
const { probeFolder } = require("./odfu/core/mediainfo");
const { findBdInfo } = require("./odfu/core/bdinfo");
const { infer } = require("./odfu/core/categories");
const { parseReleaseName } = require("./odfu/core/naming");
const { generateNfo } = require("./odfu/core/nfo");
const { generateSfv } = require("./odfu/core/sfv");
const { captureFrames, buildContactSheet } = require("./odfu/core/screenshots");
const { uploadImages } = require("./odfu/core/imagebb");
const { createTorrent, crossSeed } = require("./odfu/core/torrent");
const { lookup } = require("./odfu/core/synopsis");
const { buildPayload } = require("./odfu/core/tracker");

const USAGE = `
Usage: node main.js [--headless] --input <path> [--submit] [--config <path>]

Options:
  --headless        Run without interactive prompts (required for CLI/seedbox use).
  --input <path>    Release folder OR an existing .torrent (cross-seed). Required.
  --submit          After building, submit to 0dayfiles.net (form mode) or write manual artifacts.
  --config <path>   Explicit config path (defaults to config.toml in CWD).
  --help            Show this help.

Examples:
  node main.js --headless --input "Movie.Name.2024.1080p.BluRay.x264-GRP"
  node main.js --headless --input "Movie.Name.2024.1080p.BluRay.x264-GRP.torrent"
  node main.js --headless --input "Movie.Name.2024.1080p.BluRay.x264-GRP" --submit
`;

function parseArgs(argv) {
  const args = { headless: false, input: null, submit: false, config: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--headless") args.headless = true;
    else if (a === "--submit") args.submit = true;
    else if (a === "--config") args.config = argv[++i];
    else if (a === "--input") args.input = argv[++i];
    else if (a.startsWith("--input=")) args.input = a.slice("--input=".length);
    else if (a.startsWith("--config=")) args.config = a.slice("--config=".length);
  }
  return args;
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const cfg = load(args.config);
  log(`config loaded from ${configPath(args.config)}`);

  if (!args.input) {
    console.error(USAGE);
    process.exit(2);
  }

  const inputPath = path.resolve(args.input);
  const isTorrent = path.extname(inputPath).toLowerCase() === ".torrent";

  const release = new Release({
    sourceDir: isTorrent ? null : inputPath,
    sourceTorrent: isTorrent ? inputPath : null,
    crossSeed: isTorrent,
    outputDir: null,
  });

  try {
    if (isTorrent) {
      // Cross-seed: reuse existing torrent metadata.
      log("cross-seed mode: reusing existing .torrent metadata");
      const { torrentPath, infohash, pieceLength, totalSize } = crossSeed(
        inputPath, null, cfg
      );
      release.torrentPath = torrentPath;
      release.infohash = infohash;
      release.pieceLength = pieceLength;
      release.torrentSeconds = 0;
      release.totalSize = totalSize;
      release.state = StepState.DONE;
      release.note("cross-seed built");
    } else {
      // Full pipeline: scan -> probe -> build -> NFO -> SFV -> screenshots -> upload images.
      await scanRelease(release, { log });

      // Category inference from name + extensions.
      const parsed = parseReleaseName(path.basename(inputPath));
      release.title = parsed.title || path.basename(inputPath);
      release.year = parsed.year || "";
      release.parsed = parsed;
      release.author = parsed.author || "";
      release.series = parsed.series || "";

      const cat = infer({
        extensions: release.extensions,
        title: release.title,
        category: release.category,
      });
      release.category = cat.label;
      release.categoryId = cat.id;
      log(`category: ${cat.label} (${cat.type})`);

      // MediaInfo probe.
      release.state = StepState.PROBING;
      release.note("probing media");
      const probe = await probeFolder(inputPath, cfg.general.mediainfo_cli_path);
      release.media = probe.headline || { available: false };
      release.mediaInfoText = probe.headline ? probe.headline.rawReport : "";
      release.note(`media probe: ${probe.available ? "ok" : "fallback"}`);

      // BDInfo.
      const bd = findBdInfo(inputPath);
      if (bd.found) {
        release.bdinfo = bd.summaryText || "";
        release.note("BDInfo found");
      }

      // Description from embedded blurb (placeholder: use mediainfo text as base).
      const synCfg = cfg.synopsis;
      if (synCfg.enabled && synCfg.auto_fetch) {
        try {
          const result = await lookup(release.title, release.year, cat.type, synCfg);
          if (result.ok) {
            release.description = result.text;
            release.descriptionAuto = true;
            release.synopsisSource = result.source;
            release.synopsisUrl = result.url;
            log(`synopsis from ${result.source}`);
          }
        } catch (_) {
          // synopsis optional
        }
      }
      if (!release.description) {
        release.description = release.mediaInfoText || `Release: ${release.title}`;
        release.descriptionAuto = true;
      }

      // Build torrent + NFO.
      release.state = StepState.BUILDING;
      release.note("building torrent");
      const { torrentPath, infohash } = await createTorrent(
        inputPath, null, cfg, { log }
      );
      release.torrentPath = torrentPath;
      release.infohash = infohash;
      release.note("torrent built");

      const nfo = generateNfo(release);
      const nfoPath = path.join(
        path.dirname(torrentPath),
        `${slug(release.title)}${cfg.general.nfo_extension}`
      );
      fs.writeFileSync(nfoPath, nfo.xml, "utf8");
      release.nfoPath = nfoPath;
      release.note(`NFO written: ${nfo.xml.slice(0, 40)}...`);

      // SFV.
      if (cfg.general.generateSfv) {
        await generateSfv(release);
      }

      // Screenshots + upload images (auto-thumbnail).
      if (cfg.general.autoThumbnail) {
        try {
          const video = (fs.readdirSync(inputPath))
            .map((f) => path.join(inputPath, f))
            .filter((f) => fs.statSync(f).isFile())
            .filter((f) => ["mkv", "mp4", "avi", "mov"].includes(path.extname(f).toLowerCase().slice(1)))
            .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
          if (video) {
            const cap = await captureFrames(video, path.dirname(torrentPath));
            if (cap.success && cap.frames.length) {
              const sheet = await buildContactSheet(cap.frames, path.dirname(torrentPath));
              if (sheet.success) {
                release.images.push({ filePath: sheet.sheetPath, displayUrl: "", url: "", host: "" });
                const up = await uploadImages([sheet.sheetPath], cfg.imagebb);
                if (up[0].success) {
                  release.images[0].displayUrl = up[0].image.displayUrl;
                  release.images[0].url = up[0].image.url;
                  release.images[0].host = up[0].host;
                  log(`thumbnail uploaded to ${up[0].host}`);
                }
              }
            }
          }
        } catch (_) {
          // thumbnail optional
        }
      }

      release.state = StepState.DONE;
      release.note("pipeline complete");
    }

    // Write release metadata.
    release.exportJson();

    // Submit (form mode writes artifacts; manual mode writes + opens page).
    if (args.submit) {
      const result = await tracker.submit(release, cfg, {
        dryRun: cfg.tracker.mode === "manual",
        openBrowser: false,
      });
      release.submission = result;
      log(result.message);
    } else {
      log(`artifacts written. Run with --submit to upload (mode: ${cfg.tracker.mode}).`);
    }

    log(`state: ${release.status()}`);
    process.exit(0);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    release.error = err.message;
    release.state = StepState.ERROR;
    try { release.exportJson(); } catch (_) {}
    process.exit(1);
  }
}

run();
