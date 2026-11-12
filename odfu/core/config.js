"use strict";

const fs = require("fs");
const path = require("path");
const toml = require("toml");

const CONFIG_FILENAME = "config.toml";
const APP_NAME = "0dayfiles-upload-helper-ultra";
const SECRET_KEYRING_SERVICE = "0dayfiles-upload-helper-ultra";

const SECRET_FIELDS = new Set([
  "imagebb.api_key",
  "tracker.api_token",
  "synopsis.tmdb_api_key",
  "synopsis.hardcover_api_key",
  "metadata.tvdb_api_key",
  "metadata.igdb_client_id",
  "metadata.igdb_client_secret",
  "metadata.imdb_api_key",
  "metadata.discogs_token",
  "metadata.lastfm_api_key",
  "web.auth_username",
  "web.auth_password",
]);

const SECTIONS = ["general", "torrent", "imagebb", "tracker", "synopsis", "metadata", "web"];

/** Resolve the config file path. CWD config.toml wins; else platform config dir. */
function configPath() {
  const local = path.join(process.cwd(), CONFIG_FILENAME);
  if (fs.existsSync(local)) return local;
  let base;
  if (process.platform === "win32") {
    base = process.env.APPDATA || path.join(require("os").homedir(), "AppData", "Roaming");
  } else {
    base = process.env.XDG_CONFIG_HOME || path.join(require("os").homedir(), ".config");
  }
  return path.join(base, APP_NAME, CONFIG_FILENAME);
}

/**
 * Load config from TOML, applying env overrides (ODFU_SECTION_KEY).
 * Secrets are read from env only (no keychain in headless seedbox build).
 */
function load(rawPath) {
  const cfg = {};
  const filePath = rawPath || configPath();
  let raw = {};
  if (fs.existsSync(filePath)) {
    try {
      raw = toml.parse(fs.readFileSync(filePath, "utf8"));
    } catch (exc) {
      console.error(`[odfu] warning: could not read ${filePath}: ${exc.message}`);
    }
  }

  for (const section of SECTIONS) {
    cfg[section] = {};
    const fileSection = typeof raw[section] === "object" ? raw[section] : {};
    for (const [key, val] of Object.entries(fileSection)) {
      cfg[section][key] = val;
    }
  }

  // Env overrides: ODFU_GENERAL_OUT_DIR, ODFU_TRACKER_API_TOKEN, etc.
  const prefix = "ODFU_";
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (!envKey.startsWith(prefix)) continue;
    const rest = envKey.slice(prefix.length);
    const underscore = rest.indexOf("_");
    if (underscore === -1) continue;
    const section = rest.slice(0, underscore).toLowerCase();
    const key = rest.slice(underscore + 1).toLowerCase();
    if (!SECTIONS.includes(section)) continue;
    cfg[section][key] = envVal;
  }

  // beats-rename-style env var overrides (PORT, ROOT_DIR, AUTH_*, FORCE_SECURE).
  if (process.env.PORT) {
    cfg.web = cfg.web || {};
    cfg.web.port = Number(process.env.PORT) || cfg.web.port;
  }
  if (process.env.ROOT_DIR) {
    cfg.web = cfg.web || {};
    cfg.web.browse_root = process.env.ROOT_DIR;
  }
  if (process.env.AUTH_USER) {
    cfg.web = cfg.web || {};
    cfg.web.auth_username = process.env.AUTH_USER;
  }
  if (process.env.AUTH_PASS) {
    cfg.web = cfg.web || {};
    cfg.web.auth_password = process.env.AUTH_PASS;
  }
  if (process.env.AUTH_SECRET) {
    cfg.web = cfg.web || {};
    cfg.web.auth_secret = process.env.AUTH_SECRET;
  }
  if (process.env.FORCE_SECURE) {
    cfg.web = cfg.web || {};
    cfg.web.force_secure = process.env.FORCE_SECURE === "1" || process.env.FORCE_SECURE === "true";
  }

  // Apply defaults.
  applyDefaults(cfg);
  return cfg;
}

function applyDefaults(cfg) {
  const d = (section, key, def) => {
    if (cfg[section][key] === undefined || cfg[section][key] === "") {
      cfg[section][key] = def;
    }
  };

  d("general", "out_dir", "");
  d("general", "seeding_dir", "");
  d("general", "auto_upload", false);
  d("general", "auto_thumbnail", true);
  d("general", "generate_sfv", true);
  d("general", "mediainfo_cli_path", "");
  d("general", "open_folder_after", true);
  d("general", "include_technical_in_description", false);
  d("general", "description_footer", "");
  d("general", "language", "English");
  d("general", "nfo_extension", ".nfo");

  d("torrent", "announce", "");
  d("torrent", "announce_tiers", []);
  d("torrent", "private", true);
  d("torrent", "source", null);
  d("torrent", "created_by", "0dayfiles-upload-helper-ultra/1.0");
  d("torrent", "comment", null);
  d("torrent", "announce_list_mode", "flat");
  d("torrent", "piece_length", 0);
  d("torrent", "pad_to", 0);
  d("torrent", "exclude_globs", [".pad/*"]);
  d("torrent", "exclude_dirs", [".pad"]);
  d("torrent", "follow_symlinks", false);
  d("torrent", "natural_sort", true);

  d("imagebb", "provider", "auto");
  d("imagebb", "api_key", "");
  d("imagebb", "api_url", "https://api.imgbb.com/1/upload");
  d("imagebb", "catbox_userhash", "");
  d("imagebb", "imgcdn_api_key", "");
  d("imagebb", "imgcdn_api_url", "https://imgcdn.dev/api/1/upload");
  d("imagebb", "hotimg_api_key", "");
  d("imagebb", "hotimg_api_url", "https://hotimg.com/api/1/upload");
  d("imagebb", "imghosting_api_key", "");
  d("imagebb", "imghosting_api_url", "https://api.imghosting.in/upload");
  d("imagebb", "freeimage_api_key", "");
  d("imagebb", "freeimage_api_url", "https://freeimage.host/api/1/upload");
  d("imagebb", "expiration", 0);
  d("imagebb", "timeout", 60);
  d("imagebb", "retries", 3);

  d("tracker", "base_url", "https://0dayfiles.net");
  d("tracker", "form_path", "/torrents/create");
  d("tracker", "submit_path", "/api/torrents/upload");
  d("tracker", "mode", "manual");
  d("tracker", "api_token", "");
  d("tracker", "timeout", 45);
  d("tracker", "retries", 2);
  d("tracker", "verify_tls", true);
  d("tracker", "user_agent", "Mozilla/5.0 (0dayfiles-upload-helper-ultra)");
  d("tracker", "field_map", {
    title: "name",
    category_id: "category_id",
    description: "description",
    keywords: "keywords",
    mediainfo: "mediainfo",
    bdinfo: "bdinfo",
    season_number: "season_number",
    episode_number: "episode_number",
    anon: "anonymous",
    personal_release: "personal_release",
    tmdb_movie_id: "tmdb",
    tmdb_tv_id: "tmdb",
    tmdb: "tmdb",
    tvdb: "tvdb",
    igdb: "igdb",
    imdb: "imdb",
    boost_ask: "boost_ask",
    boost_free: "boost[free]",
    boost_free_days: "boost[free_days]",
    boost_du_days: "boost[du_days]",
    boost_featured: "boost[featured]",
    boost_reason: "boost_reason",
  });

  d("synopsis", "enabled", true);
  d("synopsis", "providers", ["applebooks", "openlibrary", "hardcover", "googlebooks", "wikipedia", "tmdb"]);
  d("synopsis", "tmdb_api_key", "");
  d("synopsis", "hardcover_api_key", "");
  d("synopsis", "threshold", 0.86);
  d("synopsis", "timeout", 12);
  d("synopsis", "cache", true);
  d("synopsis", "auto_fetch", false);
  d("synopsis", "include_year", true);

  d("metadata", "tvdb_api_key", "");
  d("metadata", "igdb_client_id", "");
  d("metadata", "igdb_client_secret", "");
  d("metadata", "imdb_api_key", "");
  d("metadata", "discogs_token", "");
  d("metadata", "lastfm_api_key", "");

  d("web", "bind", "127.0.0.1");
  d("web", "port", 0);
  d("web", "watch_folder", "");
  d("web", "max_concurrent_jobs", 1);
  d("web", "job_retention_minutes", 60);
  d("web", "browse_root", "");
  d("web", "auth_enabled", true);
  d("web", "auth_username", "");
  d("web", "auth_password", "");
  d("web", "rate_limit_max", 60);
  d("web", "rate_limit_window_seconds", 60);
  d("web", "ip_allowlist", ["127.0.0.1", "::1"]);
  d("web", "auth_secret", "");

  // Coerce booleans from env strings.
  for (const s of SECTIONS) {
    for (const [k, v] of Object.entries(cfg[s])) {
      if (v === "true") cfg[s][k] = true;
      else if (v === "false") cfg[s][k] = false;
    }
  }

  // Coerce numeric port from env strings.
  if (typeof cfg.web.port === "string") {
    const n = Number(cfg.web.port);
    if (!Number.isNaN(n)) cfg.web.port = n;
  }
  if (typeof cfg.web.max_concurrent_jobs === "string") {
    const n = Number(cfg.web.max_concurrent_jobs);
    if (!Number.isNaN(n)) cfg.web.max_concurrent_jobs = n;
  }
  if (typeof cfg.web.job_retention_minutes === "string") {
    const n = Number(cfg.web.job_retention_minutes);
    if (!Number.isNaN(n)) cfg.web.job_retention_minutes = n;
  }
  if (typeof cfg.web.rate_limit_max === "string") {
    const n = Number(cfg.web.rate_limit_max);
    if (!Number.isNaN(n)) cfg.web.rate_limit_max = n;
  }
  if (typeof cfg.web.rate_limit_window_seconds === "string") {
    const n = Number(cfg.web.rate_limit_window_seconds);
    if (!Number.isNaN(n)) cfg.web.rate_limit_window_seconds = n;
  }

  return cfg;
}

function isSecret(section, key) {
  return SECRET_FIELDS.has(`${section}.${key}`);
}

function masked(val) {
  if (!val) return "";
  const s = String(val);
  if (s.length <= 8) return "********";
  return `${s.slice(0, 2)}${"*".repeat(Math.max(4, s.length - 4))}${s.slice(-2)}`;
}

module.exports = { load, configPath, isSecret, masked, SECTIONS, SECRET_FIELDS };
