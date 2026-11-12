"use strict";

const fs = require("fs");
const path = require("path");

const FORM_PATH = "/torrents/create";
const SUBMIT_PATH = "/api/torrents/upload";

// 0dayfiles.net allows ~30 API requests per minute per member.
let LAST_REQUEST_TIME = 0;
const MIN_REQUEST_GAP = 2.1; // seconds

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimit() {
  await new Promise((resolve) => {
    const tryNow = () => {
      const now = Date.now();
      const wait = MIN_REQUEST_GAP * 1000 - (now - LAST_REQUEST_TIME);
      if (wait > 0) {
        setTimeout(tryNow, wait);
      } else {
        LAST_REQUEST_TIME = Date.now();
        resolve();
      }
    };
    tryNow();
  });
}

function _firstError(text) {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      return String(data.message || data.error || text.slice(0, 300));
    }
  } catch (_) {
    // not JSON
  }
  const stripped = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, 300) || "no detail available";
}

class TrackerError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "TrackerError";
    this.status = status;
  }
}

function normalizeKeywords(text) {
  if (Array.isArray(text)) text = text.join(",");
  const parts = String(text || "").split(/[,;\n]+/);
  const seen = [];
  for (const part of parts) {
    const cleaned = String(part).replace(/\s+/g, " ").trim();
    if (cleaned && !seen.includes(cleaned)) seen.push(cleaned);
  }
  return seen.join(",");
}

function flag(value) {
  return value ? "1" : "0";
}

function requireCategories() {
  return require("./categories");
}

/**
 * Build the submission payload mapped to the tracker's real field names.
 */
function buildPayload(release, fieldMap = {}) {
  const cat =
    requireCategories().byId(release.category_id) ||
    requireCategories().byLabel(release.category || "");

  const canonical = {
    title: release.title || "",
    category_id: cat ? cat.id : "",
    category_label: cat ? cat.label : (release.category || ""),
    description: release.description || "",
    keywords: normalizeKeywords(release.keywords),
    mediainfo: release.mediaInfoText || "",
    bdinfo: release.bdinfo || "",
    season_number: release.season || "",
    episode_number: release.episode || "",
    anon: flag(release.anon),
    personal_release: flag(release.personal_release),
  };

  const tmdbId = (release.tmdbMovieId || release.tmdbTvId || "").trim();
  canonical.tmdb = tmdbId;

  const imdbRaw = String(release.imdbId || "");
  let imdbNum = imdbRaw.replace(/[^0-9]/g, "");
  imdbNum = imdbNum.replace(/^0+/, "") || imdbNum;
  if (!imdbNum) imdbNum = "";

  for (const [idField, value] of [
    ["tvdb", release.tvdbId],
    ["igdb", release.igdbId],
    ["imdb", imdbNum],
  ]) {
    canonical[idField] = String(value || "").trim();
  }

  const images = (release.images || [])
    .map((i) => i.displayUrl || i.url)
    .filter(Boolean);
  if (images.length) canonical.imageUrls = images.join("\n");

  const dupeReason = String(release.dupeReason || "").trim();
  const dupeNote = String(release.dupeNote || "").trim().slice(0, 255);
  if (dupeReason) canonical.dupeReason = dupeReason;
  if (dupeNote) canonical.dupeNote = dupeNote;

  const mapped = {};
  const canonicalKeys = [
    "title",
    "category_id",
    "category_label",
    "description",
    "keywords",
    "mediainfo",
    "bdinfo",
    "season_number",
    "episode_number",
    "anon",
    "personal_release",
    "tmdb",
    "tvdb",
    "igdb",
    "imdb",
    "imageUrls",
    "dupeReason",
    "dupeNote",
  ];
  for (const key of canonicalKeys) {
    const value = canonical[key];
    if (value === undefined || value === null || value === "") continue;
    const target = fieldMap[key] || key;
    if (!target) continue;
    mapped[target] = Array.isArray(value) ? value.join("\n") : String(value);
  }

  if (mapped.anon) {
    mapped.anonymous = mapped.anon;
    delete mapped.anon;
  }

  for (const opt of [
    "season_number",
    "episode_number",
    "tmdb",
    "tvdb",
    "igdb",
    "imdb",
    "bdinfo",
    "mediainfo",
    "keywords",
  ]) {
    if (!mapped[opt]) delete mapped[opt];
  }

  const files = {};
  if (release.torrentPath) files.torrent = String(release.torrentPath);
  if (release.nfoPath) files.nfo = String(release.nfoPath);
  if (release.coverPath) files["torrent-cover"] = String(release.coverPath);
  if (release.bannerPath) files["torrent-banner"] = String(release.bannerPath);

  // Boost-request fields (0dayfiles.net UNIT3D form, 10 asks per month).
  const boostAsk = Boolean(release.boostAsk);
  const boostFieldMap = {
    boost_ask: fieldMap.boost_ask || "boost_ask",
    boost_free: fieldMap.boost_free || "boost[free]",
    boost_free_days: fieldMap.boost_free_days || "boost[free_days]",
    boost_du_days: fieldMap.boost_du_days || "boost[du_days]",
    boost_featured: fieldMap.boost_featured || "boost[featured]",
    boost_reason: fieldMap.boost_reason || "boost_reason",
  };
  mapped[boostFieldMap.boost_ask] = boostAsk ? "1" : "0";

  if (boostAsk) {
    const boostFree = Number(release.boostFree || 0);
    if ([25, 50, 75, 100].includes(boostFree))
      mapped[boostFieldMap.boost_free] = String(boostFree);
    const boostFreeDays = Number(release.boostFreeDays || 0);
    if ([1, 3, 7].includes(boostFreeDays))
      mapped[boostFieldMap.boost_free_days] = String(boostFreeDays);
    const boostDuDays = Number(release.boostDuDays || 0);
    if ([1, 3, 7].includes(boostDuDays))
      mapped[boostFieldMap.boost_du_days] = String(boostDuDays);
    if (release.boostFeatured) mapped[boostFieldMap.boost_featured] = "1";
    const boostReason = String(release.boostReason || "").trim().slice(0, 500);
    if (boostReason) mapped[boostFieldMap.boost_reason] = boostReason;
  }

  return {
    canonical,
    mapped,
    files,
    sourceUrl: String(release.sourceDir || ""),
  };
}

function validateRelease(release) {
  const problems = [];

  if (!release.torrentPath || !fs.existsSync(release.torrentPath)) {
    problems.push("no .torrent generated yet - build the torrent first");
  }

  const title = String(release.title || "").trim();
  if (!title) problems.push("title is required");

  const cat =
    requireCategories().byId(release.category_id) ||
    requireCategories().byLabel(release.category || "");
  if (!cat) problems.push("category is required");

  if (!String(release.description || "").trim()) problems.push("description is required");

  if (cat && cat.type === "tv") {
    if (cat.pack && !release.season)
      problems.push(`${cat.label} is a pack - set the season number`);
    if (!String(release.season || "").trim())
      problems.push(`${cat.label} requires a season number`);
    if (!String(release.episode || "").trim())
      problems.push(`${cat.label} requires an episode number (0 for a pack)`);
  }

  for (const [attr, fieldName] of [
    ["coverPath", "torrent-cover"],
    ["bannerPath", "torrent-banner"],
  ]) {
    const value = String(release[attr] || "").trim();
    if (!value) continue;
    const ext = path.extname(value).toLowerCase();
    if (ext !== ".jpg" && ext !== ".jpeg") {
      problems.push(`${fieldName} must be a .jpg or .jpeg (got ${path.basename(value)})`);
    }
  }

  return problems;
}

async function _multipartSubmit(submitUrl, mapped, files, cfg, apiToken) {
  const FormData = globalThis.FormData;
  const fetch = globalThis.fetch;

  const form = new FormData();
  for (const [k, v] of Object.entries(mapped)) form.append(k, v);
  form.append("api_token", apiToken);
  for (const [fieldName, filePath] of Object.entries(files)) {
    if (fs.existsSync(filePath)) {
      form.append(fieldName, fs.createReadStream(filePath));
    }
  }

  const headers = {
    "User-Agent": cfg.tracker.user_agent || "0dayfiles-upload-helper-ultra",
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
    ...form.getHeaders(),
  };

  await rateLimit();
  const response = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: form,
  });
  return response;
}

async function submit(release, cfg, { dryRun = false, openBrowser = true } = {}) {
  const fieldMap = cfg.tracker.field_map || {};
  const { canonical, mapped, files, sourceUrl } = buildPayload(release, fieldMap);
  const problems = validateRelease(release);
  const blocking = problems.filter(
    (p) => p.includes("no .torrent") || p.includes("required")
  );

  const base = String(cfg.tracker.base_url || "https://0dayfiles.net").replace(/\/+$/, "");
  const submitPath = cfg.tracker.submit_path || SUBMIT_PATH;
  const submitUrl = base + submitPath;

  const outDir = path.resolve(release.outputDir || release.sourceDir || ".");
  fs.mkdirSync(outDir, { recursive: true });
  const stem = release.torrentPath
    ? path.basename(release.torrentPath, path.extname(release.torrentPath))
    : "release";

  const jsonPath = path.join(outDir, `${stem}.submission.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ canonical, mapped, files, source_dir: sourceUrl }, null, 2)
  );

  const urlPath = path.join(outDir, `${stem}.submission.url.txt`);
  fs.writeFileSync(urlPath, `${base + FORM_PATH}\n`);

  const artifacts = [jsonPath, urlPath];

  if (dryRun) {
    return {
      ok: true,
      mode: "preview",
      message:
        "Payload written (nothing was uploaded)." +
        (problems.length ? "\n\nWarnings:\n- " + problems.join("\n- ") : ""),
      url: base + FORM_PATH,
      payload: { canonical, mapped, files },
      artifacts,
    };
  }

  if (cfg.tracker.mode !== "form") {
    return {
      ok: true,
      mode: "manual",
      message:
        "Artifacts written. Open the upload page and paste values from .submission.json." +
        (problems.length ? "\n\nWarnings:\n- " + problems.join("\n- ") : ""),
      url: base + FORM_PATH,
      payload: { canonical, mapped, files },
      artifacts,
    };
  }

  if (blocking.length)
    throw new TrackerError("cannot submit yet:\n- " + blocking.join("\n- "));
  if (problems.length)
    throw new TrackerError("will likely be rejected:\n- " + problems.join("\n- "));

  const apiToken = String(cfg.tracker.api_token || "");
  if (!apiToken)
    throw new TrackerError("UNIT3D API token is not set (Settings -> Tracker -> API token).");

  // Duplicate check: title search.
  let dupeWarnings = [];
  try {
    const matches = await searchTitle(release, cfg);
    if (matches && matches.length)
      dupeWarnings.push(`possible dupe by title: ${matches.length} match(es) on 0dayfiles`);
  } catch (_) {
    // ignore title-search failures
  }
  try {
    const dupeResult = await dupeCheck(release, cfg);
    if (dupeResult.level && dupeResult.level !== "none")
      dupeWarnings.push(`dupe-check level: ${dupeResult.level}`);
    if (dupeResult.exact && dupeResult.exact.length) {
      throw new TrackerError(
        "exact duplicate found on 0dayfiles:\n- " +
          dupeResult.exact
            .slice(0, 5)
            .map((m) => (m && m.attributes ? m.attributes.name : m))
            .join("\n- ")
      );
    }
    if (dupeResult.release && dupeResult.release.length)
      dupeWarnings.push(`release-level dupe: ${dupeResult.release.length} match(es)`);
    if (dupeResult.others && dupeResult.others.length)
      dupeWarnings.push(`other dupe matches: ${dupeResult.others.length}`);
  } catch (e) {
    if (e instanceof TrackerError) throw e;
    // ignore other failures
  }

  let response;
  try {
    response = await _multipartSubmit(submitUrl, mapped, files, cfg, apiToken);
  } catch (err) {
    throw new TrackerError(`upload request failed: ${err.message}`);
  }

  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new TrackerError(`HTTP ${response.status}: ${_firstError(text)}`, {
      status: response.status,
    });
  }

  let result = {};
  try {
    result = await response.json();
  } catch (_) {
    result = {};
  }

  if (result.success === false) {
    const msg = result.message || result.error || "upload failed";
    throw new TrackerError(`tracker rejected the upload: ${msg}`);
  }

  const downloadUrl = result.data || "";
  let message = result.message || `Uploaded (HTTP ${response.status}).`;
  if (dupeWarnings.length)
    message += "\n\nDuplicate warnings:\n- " + dupeWarnings.join("\n- ");

  // Download official .torrent for seeding (if configured).
  let savedTorrent = null;
  if (downloadUrl) {
    savedTorrent = await downloadOfficialTorrent(downloadUrl, cfg, release);
    if (savedTorrent) message += `\n\nOfficial torrent saved to: ${savedTorrent}`;
    if (savedTorrent) artifacts.push(savedTorrent);
  }

  return {
    ok: true,
    mode: "form",
    message,
    url: submitUrl,
    redirectUrl: downloadUrl,
    payload: { canonical, mapped, files },
    artifacts,
    responseExcerpt: (await response.text().catch(() => "")).slice(0, 400),
  };
}

async function dupeCheck(release, cfg) {
  const fieldMap = cfg.tracker.field_map || {};
  const { mapped } = buildPayload(release, fieldMap);
  const problems = validateRelease(release);
  const blocking = problems.filter(
    (p) => p.includes("no .torrent") || p.includes("required")
  );
  if (blocking.length)
    throw new TrackerError("cannot check dupes yet:\n- " + blocking.join("\n- "));

  const base = String(cfg.tracker.base_url || "https://0dayfiles.net").replace(/\/+$/, "");
  const submitUrl = base + "/api/torrents/dupe-check";

  const apiToken = String(cfg.tracker.api_token || "");
  if (!apiToken) throw new TrackerError("UNIT3D API token is not set.");

  const FormData = globalThis.FormData;
  const fetch = globalThis.fetch;

  const form = new FormData();
  for (const [k, v] of Object.entries(mapped)) form.append(k, v);
  form.append("api_token", apiToken);

  await rateLimit();
  const response = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "User-Agent": cfg.tracker.user_agent || "0dayfiles-upload-helper-ultra",
      Authorization: `Bearer ${apiToken}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    throw new TrackerError(`HTTP ${response.status}: ${_firstError(text)}`, {
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (_) {
    return {};
  }
}

async function searchTitle(release, cfg) {
  const base = String(cfg.tracker.base_url || "https://0dayfiles.net").replace(/\/+$/, "");
  const apiToken = String(cfg.tracker.api_token || "");
  if (!apiToken) return [];

  const fetch = globalThis.fetch;
  const naming = require("./naming");
  let raw = String(release.sourceDir || "");
  if (!raw) raw = String(release.title || "");
  let title = "";
  try {
    const parsed = naming.parseReleaseName(raw);
    title = (parsed.title || "").trim();
    if (parsed.year && !title.includes(parsed.year))
      title = `${title} ${parsed.year}`.trim();
  } catch (_) {
    title = "";
  }
  if (!title) title = String(release.title || "").trim();
  if (!title) return [];

  await rateLimit();
  let response;
  try {
    response = await fetch(`${base}/api/torrents/filter`, {
      method: "GET",
      headers: {
        "User-Agent": cfg.tracker.user_agent || "0dayfiles-upload-helper-ultra",
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });
  } catch (_) {
    return [];
  }
  if (response.status >= 400) return [];
  try {
    const data = await response.json();
    const items = Array.isArray(data)
      ? data
      : data && data.data
      ? data.data
      : [];
    return Array.isArray(items) ? items : [];
  } catch (_) {
    return [];
  }
}

async function downloadOfficialTorrent(downloadUrl, cfg, release) {
  if (!downloadUrl) return null;
  const seeding = String(
    cfg.general.seeding_dir || cfg.general.out_dir || ""
  ).trim();
  if (!seeding) return null;
  const folder = path.resolve(seeding);
  fs.mkdirSync(folder, { recursive: true });

  let stem;
  if (release && release.title) {
    stem = String(release.title)
      .replace(/[^A-Za-z0-9._-]+/g, ".")
      .replace(/\.+$/, "") || "release";
  } else {
    try {
      stem = path.basename(new URL(downloadUrl).pathname) || "release";
    } catch (_) {
      stem = "release";
    }
  }
  const dest = path.join(folder, `${stem}.torrent`);

  const fetch = globalThis.fetch;
  const headers = {
    "User-Agent": cfg.tracker.user_agent || "0dayfiles-upload-helper-ultra",
  };
  const apiToken = String(cfg.tracker.api_token || "");
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

  await rateLimit();
  try {
    const response = await fetch(downloadUrl, {
      headers,
      timeout: (cfg.tracker.timeout || 45) * 1000,
    });
    if (!response.ok) return null;
    const buf = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(dest, buf);
    return dest;
  } catch (_) {
    return null;
  }
}

module.exports = {
  FORM_PATH,
  SUBMIT_PATH,
  TrackerError,
  buildPayload,
  validateRelease,
  submit,
  dupeCheck,
  searchTitle,
  downloadOfficialTorrent,
  rateLimit,
  _firstError,
  normalizeKeywords,
  flag,
};
