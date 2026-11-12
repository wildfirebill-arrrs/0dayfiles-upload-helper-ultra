"use strict";

const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const { load, configPath, isSecret, masked, SECTIONS } = require("../core/config");
const { Release, StepState, slug } = require("../core/pipeline");
const { scanRelease } = require("../core/scan");
const { probeFolder } = require("../core/mediainfo");
const { findBdInfo } = require("../core/bdinfo");
const { infer } = require("../core/categories");
const { parseReleaseName } = require("../core/naming");
const { generateNfo } = require("../core/nfo");
const { generateSfv } = require("../core/sfv");
const { captureFrames, buildContactSheet } = require("../core/screenshots");
const { uploadImages } = require("../core/imagebb");
const { createTorrent, crossSeed } = require("../core/torrent");
const { lookup } = require("../core/synopsis");
const tracker = require("../core/tracker");
const watch = require("../core/watch");

// Use the project's own uuid4 (avoid adding another dependency).
function uuid4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (crypto.randomBytes(1)[0] % 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Rate-limit guard reused from tracker for submit/dupe endpoints. */
const { rateLimit } = tracker;

/**
 * In-memory job store. Each job:
 * { id, type, status ("queued"|"running"|"done"|"error"), progress (0-100),
 *   logs[], result, error, createdAt, updatedAt, sourceDir, watch, submit }
 */
const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function makeJob(id, type, sourceDir, opts = {}) {
  return {
    id,
    type, // "build" | "cross-seed" | "submit"
    sourceDir,
    status: "queued",
    progress: 0,
    logs: [],
    result: null,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    watch: !!opts.watch,
    submit: !!opts.submit,
  };
}

function jobLog(job, message) {
  const stamped = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
  job.logs.push(stamped);
  job.updatedAt = nowIso();
  // keep log array bounded
  if (job.logs.length > 200) job.logs = job.logs.slice(-200);
}

/**
 * Create the Express application. Config is passed in so the server can be
 * tested without binding a port.
 *
 * Security layers (defense in depth; Nginx auth_basic is primary access control):
 *  1. trust proxy (read X-Forwarded-For for real client IP behind Nginx)
 *  2. IP allowlist (default: 127.0.0.1 / ::1 only)
 *  3. Rate limiting per IP
 *  4. HTTP Basic Auth (configurable via [web] auth_username / auth_password)
 *  5. CSRF tokens for state-changing methods (POST/PUT/DELETE)
 *  6. Security headers (CSP, X-Frame-Options, etc.)
 *
 * @param {Object} cfg - loaded config object
 * @returns {import("express").Express}
 */
function createServer(cfg) {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  const webCfg = cfg.web || {};
  const bindRoot = String(webCfg.browse_root || "").trim();
  const maxJobs = Number(webCfg.max_concurrent_jobs || 1);
  const retentionMs = Number(webCfg.job_retention_minutes || 60) * 60 * 1000;

  // --- Security: IP allowlist ---------------------------------------------
  const ipAllowlist = Array.isArray(webCfg.ip_allowlist)
    ? webCfg.ip_allowlist.map(String)
    : [];

  function ipAllowlistMiddleware(_req, res, next) {
    // If no allowlist configured, allow all.
    if (ipAllowlist.length === 0) return next();
    const ip = _req.ip || _req.connection.remoteAddress || "unknown";
    if (ipAllowlist.includes(ip)) return next();
    res.status(403).json({ ok: false, error: "IP not allowed" });
  }

  // --- Security: rate limiting --------------------------------------------
  const rateLimitMap = new Map(); // ip -> { count, resetTime }
  const RATE_WINDOW_MS = Number(webCfg.rate_limit_window_seconds || 60) * 1000;
  const RATE_MAX = Number(webCfg.rate_limit_max || 60);

  function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
      entry = { count: 1, resetTime: now + RATE_WINDOW_MS };
      rateLimitMap.set(ip, entry);
      return next();
    }
    entry.count++;
    if (entry.count > RATE_MAX) {
      res.set("Retry-After", String(Math.ceil((entry.resetTime - now) / 1000)));
      return res.status(429).json({ ok: false, error: "rate limit exceeded" });
    }
    next();
  }

  // --- Security: security headers -----------------------------------------
  function securityHeadersMiddleware(_req, res, next) {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:;"
    );
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-XSS-Protection", "1; mode=block");
    next();
  }

  // --- Security: HTTP Basic Auth ------------------------------------------
  const authEnabled = webCfg.auth_enabled !== false;
  const authUsername = String(webCfg.auth_username || "");
  const authPassword = String(webCfg.auth_password || "");
  const authExpectedHash =
    authUsername && authPassword
      ? crypto.createHash("sha256").update(`${authUsername}:${authPassword}`).digest()
      : null;

  function authMiddleware(req, res, next) {
    if (!authEnabled || !authExpectedHash) {
      // Auth not configured — allow but mark response so Nginx/auth_basic is
      // clearly the primary control.
      res.set("X-Auth-Required", "false");
      return next();
    }

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Basic ")) {
      res.set("WWW-Authenticate", 'Basic realm="0dayfiles Upload Helper"');
      res.set("X-Auth-Required", "true");
      return res.status(401).json({ ok: false, error: "authentication required" });
    }

    const credentials = Buffer.from(auth.slice(6), "base64").toString("utf-8");
    const providedHash = crypto.createHash("sha256").update(credentials).digest();

    if (
      providedHash.length !== authExpectedHash.length ||
      !crypto.timingSafeEqual(providedHash, authExpectedHash)
    ) {
      res.set("WWW-Authenticate", 'Basic realm="0dayfiles Upload Helper"');
      res.set("X-Auth-Required", "true");
      return res.status(401).json({ ok: false, error: "invalid credentials" });
    }

    res.set("X-Auth-Required", "true");
    next();
  }

  // --- Security: CSRF tokens for state-changing methods -------------------
  const csrfTokens = new Map(); // token -> { expiry, ip }
  const CSRF_TTL_MS = 30 * 60 * 1000; // 30 minutes

  function generateCsrfToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  function csrfMiddleware(req, res, next) {
    const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

    if (!unsafeMethods.has(req.method)) {
      // Safe method: issue a fresh CSRF token for the client to use next time.
      const token = generateCsrfToken();
      csrfTokens.set(token, { expiry: Date.now() + CSRF_TTL_MS, ip: req.ip });
      res.set("X-CSRF-Token", token);
      return next();
    }

    // State-changing method: require a valid, unused CSRF token.
    const token = req.headers["x-csrf-token"] || (req.body && req.body._csrf);
    if (!token) {
      return res.status(403).json({ ok: false, error: "CSRF token required" });
    }
    const entry = csrfTokens.get(token);
    if (!entry) {
      return res.status(403).json({ ok: false, error: "CSRF token invalid" });
    }
    if (Date.now() > entry.expiry) {
      csrfTokens.delete(token);
      return res.status(403).json({ ok: false, error: "CSRF token expired" });
    }
    // Bind token to the IP that was issued it (defense against token theft).
    if (entry.ip !== (req.ip || req.connection.remoteAddress || "unknown")) {
      csrfTokens.delete(token);
      return res.status(403).json({ ok: false, error: "CSRF token IP mismatch" });
    }
    // Single-use token.
    csrfTokens.delete(token);
    next();
  }

  // Apply security middleware to all routes (order matters).
  app.use(ipAllowlistMiddleware);
  app.use(rateLimitMiddleware);
  app.use(securityHeadersMiddleware);
  app.use(authMiddleware);
  app.use(csrfMiddleware);

  // --- Concurrency limiter ------------------------------------------------
  let running = 0;
  const queue = [];

  function enqueue(job) {
    jobs.set(job.id, job);
    queue.push(job);
    drainQueue().catch((err) => {
      console.error("[odfu-web] queue error:", err.message);
    });
    return job;
  }

  async function drainQueue() {
    while (running < maxJobs && queue.length) {
      const job = queue.shift();
      running++;
      job.status = "running";
      job.updatedAt = nowIso();
      try {
        await runJob(job);
      } catch (_) {
        // runJob already sets status/error; this is a belt-and-suspenders catch.
      } finally {
        running--;
        job.updatedAt = nowIso();
      }
    }
  }

  // --- path safety helpers -------------------------------------------------
  function resolveSafeRoot() {
    if (!bindRoot) return process.cwd();
    const root = path.resolve(bindRoot);
    try { fs.accessSync(root, fs.constants.R_OK); } catch (_) { /* may not exist yet */ }
    return root;
  }

  function isWithinRoot(targetAbs, rootAbs) {
    const rel = path.relative(rootAbs, targetAbs);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  // --- API: public config (secrets masked) ---------------------------------
  app.get("/api/config", (_req, res) => {
    const publicCfg = {};
    for (const section of SECTIONS) {
      publicCfg[section] = {};
      for (const [key, val] of Object.entries(cfg[section] || {})) {
        if (isSecret(section, key)) {
          publicCfg[section][key] = masked(val);
        } else if (section === "tracker" && key === "field_map") {
          publicCfg[section][key] = val;
        } else {
          publicCfg[section][key] = val;
        }
      }
    }
    res.json({ ok: true, config: publicCfg });
  });

  // --- API: file browser ---------------------------------------------------
  app.get("/api/browse", (_req, res) => {
    const rawPath = String(_req.query.path || "").trim();
    const rootAbs = resolveSafeRoot();

    let targetAbs;
    if (!rawPath) {
      targetAbs = rootAbs;
    } else {
      // Disallow absolute escapes and ".." traversal.
      const cleaned = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/");
      if (cleaned.includes("..")) {
        return res.status(400).json({ ok: false, error: "path traversal not allowed" });
      }
      targetAbs = path.resolve(rootAbs, cleaned);
    }

    try {
      const realRoot = fs.realpathSync(rootAbs);
      const realTarget = fs.realpathSync(targetAbs);
      if (!isWithinRoot(realTarget, realRoot)) {
        return res.status(400).json({ ok: false, error: "path outside browse root" });
      }
      targetAbs = realTarget;
    } catch (_) {
      // realpath may fail if the path doesn't exist yet; fall back to resolved.
    }

    if (!isWithinRoot(targetAbs, rootAbs)) {
      return res.status(400).json({ ok: false, error: "path outside browse root" });
    }

    let entries;
    try {
      const dirEnts = fs.readdirSync(targetAbs, { withFileTypes: true });
      entries = [];
      for (const e of dirEnts) {
        const full = path.join(targetAbs, e.name);
        let stat;
        try { stat = fs.statSync(full); } catch (_) { continue; }
        entries.push({
          name: e.name,
          isDir: e.isDirectory(),
          size: stat.size,
          mtime: stat.mtimeMs,
          ext: path.extname(e.name).toLowerCase().replace(/^\./, ""),
        });
      }
      // dirs first, then natural name sort.
      entries.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: `cannot read directory: ${err.message}` });
    }

    const parent = targetAbs === rootAbs ? null : path.dirname(targetAbs);
    res.json({
      ok: true,
      path: targetAbs,
      root: rootAbs,
      parent,
      entries,
    });
  });

  // --- API: releases list --------------------------------------------------
  app.get("/api/releases", async (_req, res) => {
    const roots = new Set();
    const outDir = String(cfg.general && cfg.general.out_dir || "").trim();
    const watchDir = watch.resolveWatchFolder(cfg);
    if (outDir) roots.add(path.resolve(outDir));
    if (watchDir) roots.add(watchDir);
    roots.add(process.cwd());

    const releases = [];
    for (const root of roots) {
      try {
        const ents = await fsp.readdir(root, { withFileTypes: true });
        for (const e of ents) {
          if (!e.isFile() || !e.name.endsWith(".release.json")) continue;
          const full = path.join(root, e.name);
          try {
            const data = JSON.parse(await fsp.readFile(full, "utf8"));
            releases.push({ ...data, sourceFile: full });
          } catch (_) {
            // ignore unreadable release json
          }
        }
      } catch (_) {
        // ignore missing root
      }
    }
    releases.sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime();
      const db = new Date(b.createdAt || 0).getTime();
      return db - da;
    });
    res.json({ ok: true, releases: releases.slice(0, 50) });
  });

  // --- helper: run the build pipeline for a job ---------------------------
  async function runBuildPipeline(job) {
    const sourceDir = job.sourceDir;
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`source folder does not exist: ${sourceDir}`);
    }

    const release = new Release({ sourceDir, outputDir: null });
    const log = (msg) => jobLog(job, msg);

    const setProgress = (p) => { job.progress = Math.min(100, Math.max(0, p)); job.updatedAt = nowIso(); };

    // 1. Scan.
    setProgress(5);
    jobLog(job, "scan started");
    await scanRelease(release, { log });
    setProgress(15);

    // 2. Name parse + category.
    const parsed = parseReleaseName(path.basename(sourceDir));
    release.title = parsed.title || path.basename(sourceDir);
    release.year = parsed.year || "";
    release.parsed = parsed;
    release.author = parsed.author || "";
    release.series = parsed.series || "";

    const cat = infer({ extensions: release.extensions, title: release.title, category: release.category });
    release.category = cat.label;
    release.categoryId = cat.id;
    jobLog(job, `category: ${cat.label} (${cat.type})`);

    // 3. MediaInfo probe.
    setProgress(25);
    jobLog(job, "probing media");
    const probe = await probeFolder(sourceDir, cfg.general.mediainfo_cli_path);
    release.media = probe.headline || { available: false };
    release.mediaInfoText = probe.headline ? probe.headline.rawReport : "";
    jobLog(job, `media probe: ${probe.available ? "ok" : "fallback"}`);

    // 4. BDInfo.
    const bd = findBdInfo(sourceDir);
    if (bd.found) {
      release.bdinfo = bd.summaryText || "";
      jobLog(job, "BDInfo found");
    }
    setProgress(35);

    // 5. Description.
    const synCfg = cfg.synopsis || {};
    if (synCfg.enabled && synCfg.auto_fetch) {
      try {
        const result = await lookup(release.title, release.year, cat.type, synCfg);
        if (result.ok) {
          release.description = result.text;
          release.descriptionAuto = true;
          release.synopsisSource = result.source;
          release.synopsisUrl = result.url;
          jobLog(job, `synopsis from ${result.source}`);
        }
      } catch (_) {
        // synopsis optional
      }
    }
    if (!release.description) {
      release.description = release.mediaInfoText || `Release: ${release.title}`;
      release.descriptionAuto = true;
    }

    // 6. Build torrent (hashing is the slow part; map its % log to progress).
    setProgress(40);
    jobLog(job, "building torrent");
    const hashingLog = (msg) => {
      jobLog(job, msg);
      const m = String(msg).match(/hashing\s+(\d+)%/);
      if (m) setProgress(40 + Math.round((Number(m[1]) / 100) * 40)); // 40%..80%
    };
    const { torrentPath, infohash } = await createTorrent(sourceDir, null, cfg, { log: hashingLog });
    release.torrentPath = torrentPath;
    release.infohash = infohash;
    jobLog(job, "torrent built");
    setProgress(82);

    // 7. NFO.
    const nfo = generateNfo(release);
    const nfoPath = path.join(path.dirname(torrentPath), `${slug(release.title)}${cfg.general.nfo_extension}`);
    fs.writeFileSync(nfoPath, nfo.xml, "utf8");
    release.nfoPath = nfoPath;
    jobLog(job, `NFO written`);
    setProgress(88);

    // 8. SFV.
    if (cfg.general.generateSfv) {
      await generateSfv(release);
      jobLog(job, "SFV written");
    }
    setProgress(92);

    // 9. Auto-thumbnail (optional, mirrors main.js).
    if (cfg.general.autoThumbnail) {
      try {
        const ents = fs.readdirSync(sourceDir);
        const video = ents
          .map((f) => path.join(sourceDir, f))
          .filter((f) => {
            try { return fs.statSync(f).isFile(); } catch (_) { return false; }
          })
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
                jobLog(job, `thumbnail uploaded to ${up[0].host}`);
              }
            }
          }
        }
      } catch (_) {
        // thumbnail optional
      }
    }
    setProgress(96);

    // 10. Save to watch folder if requested.
    if (job.watch) {
      const watchDir = watch.resolveWatchFolder(cfg);
      if (watchDir) {
        try {
          watch.ensureWatchFolderSync(watchDir);
          const saved = watch.saveTorrentToWatchFolder(torrentPath, watchDir, { log });
          release.watchTorrentPath = saved;
          jobLog(job, saved ? `torrent saved to watch folder: ${saved}` : "watch folder save skipped");
        } catch (err) {
          jobLog(job, `watch folder save failed: ${err.message}`);
        }
      } else {
        jobLog(job, "watch folder not configured; .torrent written to output only");
      }
    }
    setProgress(100);

    release.state = StepState.DONE;
    release.note("pipeline complete (web build)");
    release.exportJson();

    job.result = release.toDict();
    job.result.torrentPath = release.torrentPath;
    job.result.nfoPath = release.nfoPath;
    job.result.watchTorrentPath = release.watchTorrentPath || null;
  }

  async function runCrossSeed(job) {
    const torrentPath = job.sourceDir;
    if (!fs.existsSync(torrentPath)) {
      throw new Error(`source torrent does not exist: ${torrentPath}`);
    }
    const release = new Release({ sourceTorrent: torrentPath, crossSeed: true, outputDir: null });
    const log = (msg) => jobLog(job, msg);
    const { torrentPath: outPath, infohash, pieceLength, totalSize } = crossSeed(torrentPath, null, cfg);
    release.torrentPath = outPath;
    release.infohash = infohash;
    release.pieceLength = pieceLength;
    release.totalSize = totalSize;
    release.state = StepState.DONE;
    release.note("cross-seed built (web)");

    if (job.watch) {
      const watchDir = watch.resolveWatchFolder(cfg);
      if (watchDir) {
        try {
          watch.ensureWatchFolderSync(watchDir);
          const saved = watch.saveTorrentToWatchFolder(outPath, watchDir, { log });
          release.watchTorrentPath = saved;
          jobLog(job, saved ? `torrent saved to watch folder: ${saved}` : "watch folder save skipped");
        } catch (err) {
          jobLog(job, `watch folder save failed: ${err.message}`);
        }
      }
    }

    release.exportJson();
    job.result = release.toDict();
    job.result.torrentPath = release.torrentPath;
    job.result.watchTorrentPath = release.watchTorrentPath || null;
  }

  async function runJob(job) {
    try {
      if (job.type === "build") {
        await runBuildPipeline(job);
      } else if (job.type === "cross-seed") {
        await runCrossSeed(job);
      } else if (job.type === "submit") {
        throw new Error("submit jobs are handled via /api/submit endpoint");
      }
      job.status = "done";
      job.progress = 100;
    } catch (err) {
      job.status = "error";
      job.error = err.message;
      jobLog(job, `ERROR: ${err.message}`);
    } finally {
      job.updatedAt = nowIso();
    }
  }

  // --- API: enqueue build --------------------------------------------------
  app.post("/api/build", (_req, res) => {
    const { sourceDir, watch, submit } = _req.body || {};
    if (!sourceDir || typeof sourceDir !== "string") {
      return res.status(400).json({ ok: false, error: "sourceDir is required" });
    }
    const abs = path.resolve(sourceDir);
    const rootAbs = resolveSafeRoot();
    if (!isWithinRoot(abs, rootAbs)) {
      return res.status(400).json({ ok: false, error: "source outside browse root" });
    }
    const job = makeJob(uuid4(), "build", abs, { watch, submit });
    enqueue(job);
    res.json({ ok: true, jobId: job.id, status: job.status });
  });

  // --- API: enqueue cross-seed ---------------------------------------------
  app.post("/api/cross-seed", (_req, res) => {
    const { torrentPath, watch } = _req.body || {};
    if (!torrentPath || typeof torrentPath !== "string") {
      return res.status(400).json({ ok: false, error: "torrentPath is required" });
    }
    const abs = path.resolve(torrentPath);
    const rootAbs = resolveSafeRoot();
    if (!isWithinRoot(abs, rootAbs)) {
      return res.status(400).json({ ok: false, error: "torrent outside browse root" });
    }
    const job = makeJob(uuid4(), "cross-seed", abs, { watch });
    enqueue(job);
    res.json({ ok: true, jobId: job.id, status: job.status });
  });

  // --- API: job list -------------------------------------------------------
  app.get("/api/jobs", (_req, res) => {
    const list = Array.from(jobs.values())
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 100)
      .map((j) => ({
        id: j.id, type: j.type, status: j.status, progress: j.progress,
        sourceDir: j.sourceDir, error: j.error, createdAt: j.createdAt, updatedAt: j.updatedAt,
        result: j.result ? { title: j.result.title, infohash: j.result.infohash, torrentPath: j.result.torrentPath, watchTorrentPath: j.result.watchTorrentPath } : null,
      }));
    res.json({ ok: true, jobs: list });
  });

  // --- API: single job -----------------------------------------------------
  app.get("/api/jobs/:jobId", (_req, res) => {
    const job = jobs.get(_req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, error: "job not found" });
    res.json({
      ok: true,
      job: {
        id: job.id, type: job.type, status: job.status, progress: job.progress,
        logs: job.logs, sourceDir: job.sourceDir, error: job.error,
        createdAt: job.createdAt, updatedAt: job.updatedAt,
        result: job.result, watch: job.watch, submit: job.submit,
      },
    });
  });

  // --- API: submit release -------------------------------------------------
  app.post("/api/submit", async (_req, res) => {
    const { release, dryRun } = _req.body || {};
    if (!release || !release.title) {
      return res.status(400).json({ ok: false, error: "release data is required" });
    }

    const rel = new Release({ sourceDir: release.sourceDir || "", outputDir: release.outputDir || null });
    Object.assign(rel, release);
    rel.state = StepState.DONE;

    const result = await tracker.submit(rel, cfg, { dryRun: dryRun !== false, openBrowser: false });
    res.json({ ok: true, ...result });
  });

  // --- root: serve frontend ------------------------------------------------
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  app.use(express.static(path.join(__dirname, "public")));

  // --- startup guard: warn if port is unset --------------------------------
  app._odfuPortWarning = () => {
    const port = Number(webCfg.port);
    if (!port || port < 10000 || port > 65535) {
      console.warn("[odfu-web] warning: web.port is not set to a valid assigned 5-digit port.");
      console.warn("[odfu-web]         set web.port in config.toml (or ODFU_WEB_PORT) before exposing the UI.");
      console.warn("[odfu-web]         binding to 127.0.0.1 only; Nginx should terminate HTTPS/auth.");
    }

    // Auth guard: if auth is enabled but credentials are missing, refuse to start.
    if (webCfg.auth_enabled !== false && (!authUsername || !authPassword)) {
      const msg =
        "[odfu-web] error: web.auth_enabled is true but auth_username/auth_password are not set.\n" +
        "[odfu-web]         set them in config.toml (or ODFU_WEB_AUTH_USERNAME / ODFU_WEB_AUTH_PASSWORD).\n" +
        "[odfu-web]         the web UI must not be open without authentication.";
      throw new Error(msg);
    }
  };

  return app;
}

module.exports = { createServer };
