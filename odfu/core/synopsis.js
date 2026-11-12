"use strict";

const fetch = globalThis.fetch;

const USER_AGENT = "0dayfiles-upload-helper-ultra/1.0";

const YEAR_RE = /(?:^|[ ._])((?:19|20)\d{2})(?:[ ._].*)?$/;
const PAREN_YEAR_RE = /\(((?:19|20)\d{2})\)/;

/** Extract last plausible year from text. */
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

/** Derive (work title, year) from a release title. */
function deriveQuery(title) {
  const text = String(title || "").trim();
  if (!text) return ["", ""];
  const year = extractYear(text);
  let query = text.replace(PAREN_YEAR_RE, "").trim();
  // Strip common scene noise trailing tokens.
  const noise = [/cd\d+/i, /part\s*\d+/i, /disc\s*\d+/i, /#\d+/i,
    /720p|1080p|2160p|4k|x264|x265|bluray|web-dl|webrip|dvdrip/i];
  for (const re of noise) {
    query = query.replace(re, "").trim();
  }
  query = query.replace(/\s{2,}/g, " ").trim();
  return [query, year];
}

function similarity(a, b) {
  const la = String(a || "").toLowerCase();
  const lb = String(b || "").toLowerCase();
  if (la === lb) return 1.0;
  if (!la || !lb) return 0.0;
  // Simple dice coefficient on bigrams.
  const bigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bigrams(la);
  const B = bigrams(lb);
  const inter = new Set([...A].filter((x) => B.has(x)));
  return (2 * inter.size) / (A.size + B.size);
}

class SynopsisCandidate {
  constructor({ title, year, text, source, matchedTitle, url } = {}) {
    this.title = title || "";
    this.year = year || "";
    this.text = text || "";
    this.source = source || "";
    this.matchedTitle = matchedTitle || "";
    this.url = url || "";
  }
}

class SynopsisResult {
  constructor({ ok, text, source, reason, matchedTitle, url, year } = {}) {
    this.ok = !!ok;
    this.text = text || "";
    this.source = source || "";
    this.reason = reason || "";
    this.matchedTitle = matchedTitle || "";
    this.url = url || "";
    this.year = year || "";
  }
}

const PROVIDERS = {
  applebooks: _appleBooks,
  openlibrary: _openLibrary,
  googlebooks: _googleBooks,
  wikipedia: _wikipedia,
  tmdb: _tmdb,
  hardcover: _hardcover,
};

/** Run enabled providers in order; return first acceptable candidate. */
async function lookup(query, year, kind, cfg) {
  const providers = (cfg.providers || ["applebooks", "openlibrary", "hardcover", "googlebooks", "wikipedia", "tmdb"])
    .filter((p) => PROVIDERS[p]);

  for (const name of providers) {
    try {
      const cand = await PROVIDERS[name](query, year, kind, cfg);
      if (cand && cand.text && cand.text.length >= 40) {
        return new SynopsisResult({
          ok: true,
          text: cand.text,
          source: name,
          matchedTitle: cand.title || query,
          url: cand.url || "",
          year: cand.year || year,
        });
      }
    } catch (_) {
      // provider failed, try next
    }
  }
  return new SynopsisResult({ ok: false, reason: "no provider returned a usable synopsis" });
}

/* ---------------- providers ---------------- */

async function _tmdb(query, year, kind, cfg) {
  if (!cfg.tmdbApiKey) return null;
  const endpoints = kind === "tv"
    ? [["search/tv", "first_air_date_year"]]
    : [["search/movie", "year"]];
  for (const [pathName, yearParam] of endpoints) {
    const params = new URLSearchParams({ api_key: cfg.tmdbApiKey, query });
    if (year) params.set(yearParam, year);
    const url = `https://api.themoviedb.org/3/${pathName}?${params}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, timeout: (cfg.timeout || 12) * 1000 });
      if (!res.ok) continue;
      const data = await res.json();
      const results = data.results || [];
      for (const item of results.slice(0, 3)) {
        const title = item.title || item.name || "";
        if (similarity(query, title) < 0.8) continue;
        const released = item.release_date || item.first_air_date || "";
        const cy = extractYear(released) || "";
        if (year && cy && cy !== year) continue;
        // Fetch overview from details endpoint.
        const detailPath = kind === "tv" ? "tv" : "movie";
        const dres = await fetch(`https://api.themoviedb.org/3/${detailPath}/${item.id}?api_key=${cfg.tmdbApiKey}`, {
          headers: { "User-Agent": USER_AGENT },
          timeout: (cfg.timeout || 12) * 1000,
        });
        let overview = "";
        if (dres.ok) {
          const d = await dres.json();
          overview = d.overview || "";
        }
        if (!overview) overview = item.overview || "";
        return new SynopsisCandidate({
          title,
          year: cy,
          text: overview,
          source: "tmdb",
          matchedTitle: title,
          url: `https://www.themoviedb.org/${detailPath}/${item.id}`,
        });
      }
    } catch (_) {
      continue;
    }
  }
  return null;
}

async function _wikipedia(query, year, kind, cfg) {
  try {
    const params = new URLSearchParams({ action: "query", list: "search", srsearch: `"${query}"`, format: "json", srlimit: 5 });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      timeout: (cfg.timeout || 12) * 1000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.query.search || [];
    for (const item of results.slice(0, 3)) {
      const title = item.title.replace(/\s*\(.*?\)\s*$/, "");
      if (similarity(query, title) < 0.75) continue;
      const cy = extractYear(item.title) || year || "";
      // Fetch extract.
      const deres = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&format=json&titles=${encodeURIComponent(item.title)}`,
        { headers: { "User-Agent": USER_AGENT }, timeout: (cfg.timeout || 12) * 1000 }
      );
      let extract = "";
      if (deres.ok) {
        const d = await deres.json();
        const pages = d.query.pages || {};
        const key = Object.keys(pages)[0];
        extract = pages[key] ? pages[key].extract || "" : "";
      }
      if (extract && extract.length >= 40) {
        return new SynopsisCandidate({
          title,
          year: cy,
          text: extract,
          source: "wikipedia",
          matchedTitle: item.title,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s/g, "_"))}`,
        });
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function _appleBooks(query, year, kind, cfg) {
  try {
    const params = new URLSearchParams({ term: query, media: "book", entity: "ebook", limit: 5 });
    const res = await fetch(`https://itunes.apple.com/search?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      timeout: (cfg.timeout || 12) * 1000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    for (const item of results.slice(0, 3)) {
      const title = item.trackName || item.collectionName || "";
      if (similarity(query, title) < 0.75) continue;
      const cy = extractYear(item.releaseDate || "") || year || "";
      const text = item.description || "";
      if (text && text.length >= 40) {
        return new SynopsisCandidate({
          title,
          year: cy,
          text,
          source: "applebooks",
          matchedTitle: title,
          url: item.trackViewUrl || item.collectionViewUrl || "",
        });
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function _openLibrary(query, year, kind, cfg) {
  try {
    const params = new URLSearchParams({ q: query, limit: 5 });
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      timeout: (cfg.timeout || 12) * 1000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const docs = data.docs || [];
    for (const doc of docs.slice(0, 3)) {
      const title = doc.title || "";
      if (similarity(query, title) < 0.75) continue;
      const cy = String(doc.first_publish_year || "") || year || "";
      // Fetch description via work key.
      let text = "";
      if (doc.key) {
        try {
          const wres = await fetch(`https://openlibrary.org${doc.key}.json`, {
            headers: { "User-Agent": USER_AGENT },
            timeout: (cfg.timeout || 12) * 1000,
          });
          if (wres.ok) {
            const w = await wres.json();
            const desc = w.description;
            text = typeof desc === "string" ? desc : (desc && desc.value) || "";
          }
        } catch (_) {}
      }
      if (!text) text = "";
      if (text && text.length >= 40) {
        return new SynopsisCandidate({
          title,
          year: cy,
          text,
          source: "openlibrary",
          matchedTitle: title,
          url: `https://openlibrary.org${doc.key}`,
        });
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function _googleBooks(query, year, kind, cfg) {
  try {
    const params = new URLSearchParams({ q: query, maxResults: 5 });
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
      headers: { "User-Agent": USER_AGENT },
      timeout: (cfg.timeout || 12) * 1000,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.items || [];
    for (const item of items.slice(0, 3)) {
      const v = item.volumeInfo || {};
      const title = v.title || "";
      if (similarity(query, title) < 0.75) continue;
      const cy = String(v.publishedDate || "").match(/\d{4}/)?.[0] || year || "";
      const text = v.description || "";
      if (text && text.length >= 40) {
        return new SynopsisCandidate({
          title,
          year: cy,
          text,
          source: "googlebooks",
          matchedTitle: title,
          url: v.infoLink || "",
        });
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function _hardcover(query, year, kind, cfg) {
  if (!cfg.hardcoverApiKey) return null;
  // Hardcover GraphQL — requires auth; minimal placeholder.
  return null;
}

module.exports = {
  deriveQuery,
  extractYear,
  similarity,
  lookup,
  SynopsisCandidate,
  SynopsisResult,
  PROVIDERS,
};
