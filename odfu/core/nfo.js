"use strict";

/**
 * NFO generation for UNIT3D trackers.
 * Schemas: <release> (most categories), <movie>, <tv>.
 */

function escapeXml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function humanSize(bytes) {
  const b = Number(bytes || 0);
  if (!b) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function buildReleaseNfo(release) {
  const title = escapeXml(release.title || "");
  const category = escapeXml(release.categoryLabel || release.category || "");
  const size = humanSize(release.totalSize);
  const files = release.fileCount || 0;
  const media = release.mediaInfoText || "";
  const imdb = escapeXml(release.imdbId || "");
  const tmdb = escapeXml(release.tmdbMovieId || release.tmdbTvId || "");

  const nfo = `<?xml version="1.0" encoding="UTF-8"?>
<release>
  <title>${title}</title>
  <category>${category}</category>
  <size>${size}</size>
  <files>${files}</files>
  <imdb>${imdb}</imdb>
  <tmdb>${tmdb}</tmdb>
  <mediainfo><![CDATA[${media}]]></mediainfo>
  <created_by>0dayfiles-upload-helper-ultra</created_by>
</release>`;
  return nfo;
}

function buildMovieNfo(release) {
  const title = escapeXml(release.title || "");
  const year = escapeXml(release.year || "");
  const imdb = escapeXml(release.imdbId || "");
  const tmdb = escapeXml(release.tmdbMovieId || "");
  const media = release.mediaInfoText || "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>${title}</title>
  <year>${year}</year>
  <imdb>${imdb}</imdb>
  <tmdb>${tmdb}</tmdb>
  <mediainfo><![CDATA[${media}]]></mediainfo>
  <created_by>0dayfiles-upload-helper-ultra</created_by>
</movie>`;
}

function buildTvNfo(release) {
  const title = escapeXml(release.title || "");
  const season = escapeXml(release.season || "");
  const episode = escapeXml(release.episode || "");
  const imdb = escapeXml(release.imdbId || "");
  const tmdb = escapeXml(release.tmdbTvId || release.tmdbMovieId || "");
  const media = release.mediaInfoText || "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <title>${title}</title>
  <season>${season}</season>
  <episode>${episode}</episode>
  <imdb>${imdb}</imdb>
  <tmdb>${tmdb}</tmdb>
  <mediainfo><![CDATA[${media}]]></mediainfo>
  <created_by>0dayfiles-upload-helper-ultra</created_by>
</tv>`;
}

/**
 * Generate an NFO for a release based on category type.
 * Returns { xml, path } (path is null — caller writes it).
 */
function generateNfo(release) {
  const cats = require("./categories");
  const cat = cats.byId(release.categoryId) || cats.byLabel(release.category || "");
  const type = cat ? cat.type : "other";

  let xml;
  if (type === "movie") xml = buildMovieNfo(release);
  else if (type === "tv") xml = buildTvNfo(release);
  else xml = buildReleaseNfo(release);

  return { xml, type };
}

module.exports = { generateNfo, buildReleaseNfo, buildMovieNfo, buildTvNfo, humanSize, escapeXml };
