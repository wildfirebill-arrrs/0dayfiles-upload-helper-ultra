"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const bencode = require("./bencode");

const PIECE_HASH_LEN = 20; // SHA-1

// Default piece-length table (total size -> piece length), mirroring common
// BitTorrent clients. Used when piece_length is not overridden.
function defaultPieceLength(totalSize) {
  if (totalSize <= 50 * 1024 * 1024) return 256 * 1024;        // 256 KB
  if (totalSize <= 100 * 1024 * 1024) return 512 * 1024;       // 512 KB
  if (totalSize <= 250 * 1024 * 1024) return 1024 * 1024;      // 1 MB
  if (totalSize <= 500 * 1024 * 1024) return 2 * 1024 * 1024;  // 2 MB
  if (totalSize <= 1 * 1024 * 1024 * 1024) return 4 * 1024 * 1024; // 4 MB
  return 4 * 1024 * 1024;                                      // 4 MB+
}

/** Natural-sort file entries (s2 before s10). */
function naturalCompare(a, b) {
  const ta = a.match(/\d+|\D+/g) || [];
  const tb = b.match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i] || "", y = tb[i] || "";
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else {
      const c = x.localeCompare(y, undefined, { numeric: false, sensitivity: "base" });
      if (c) return c;
    }
  }
  return 0;
}

/**
 * Collect release files under a folder, applying excludes.
 * Returns [{ relPath, absPath, size }] sorted naturally by relPath.
 */
function collectFiles(sourceDir, cfg) {
  const excludeGlobs = new Set((cfg.torrent.exclude_globs || []).map((g) => g.replace(/^\//, "")));
  const excludeDirs = new Set((cfg.torrent.exclude_dirs || []).map((d) => d.replace(/^\//, "")));
  const generated = new Set([".torrent", ".nfo", ".sfv"]);

  const files = [];
  const stack = [{ rel: "", abs: sourceDir }];
  while (stack.length) {
    const { rel, abs } = stack.pop();
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = rel ? path.posix.join(rel, entry.name) : entry.name;
      const absPath = path.join(abs, entry.name);

      // Exclude whole dirs.
      const topDir = relPath.split(path.posix.sep)[0];
      if (entry.isDirectory()) {
        if (excludeDirs.has(topDir)) continue;
        stack.push({ rel: relPath, abs: absPath });
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (generated.has(ext)) continue;
      // Exclude by glob patterns (simple suffix/name match).
      let excluded = false;
      for (const glob of excludeGlobs) {
        const g = glob.replace(/\*/g, ".*");
        if (new RegExp(`^${g}$`).test(relPath)) { excluded = true; break; }
        if (new RegExp(`^${g}$`).test(topDir)) { excluded = true; break; }
      }
      if (excluded) continue;

      const stat = fs.statSync(absPath);
      files.push({ relPath, absPath, size: stat.size });
    }
  }
  files.sort((a, b) => naturalCompare(a.relPath, b.relPath));
  return files;
}

/** Compute SHA-1 of a buffer. */
function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest();
}

/**
 * Hash pieces across file boundaries as one continuous stream.
 * Returns { pieces: Buffer (concatenated 20-byte hashes), pieceLength, totalSize }.
 */
async function hashPieces(files, pieceLength, { log } = {}) {
  const pieceBufs = [];
  let pieceRemaining = pieceLength;
  let pieceHash = crypto.createHash("sha1");
  let fileIndex = 0;
  let fileStream = null;
  let filePos = 0;
  let totalSize = 0;

  for (const f of files) totalSize += f.size;

  let logged = 0;
  while (fileIndex < files.length) {
    if (!fileStream) {
      fileStream = fs.createReadStream(files[fileIndex].absPath, { highWaterMark: 1 << 20 });
      filePos = 0;
    }

    const need = Math.min(pieceRemaining, files[fileIndex].size - filePos);
    const chunk = await readChunk(fileStream, need);
    if (chunk.length === 0) {
      // EOF (shouldn't happen with correct sizing, but advance safely).
      fileStream = null;
      fileIndex++;
      continue;
    }

    pieceHash.update(chunk);
    pieceRemaining -= chunk.length;
    filePos += chunk.length;

    if (pieceRemaining === 0) {
      pieceBufs.push(pieceHash.digest());
      pieceHash = crypto.createHash("sha1");
      pieceRemaining = pieceLength;
    }

    if (filePos >= files[fileIndex].size) {
      fileStream = null;
      fileIndex++;
    }

    const now = Date.now();
    if (log && now - logged > 1000) {
      logged = now;
      const done = files.slice(0, fileIndex).reduce((s, f) => s + f.size, 0) + filePos;
      log(`hashing ${Math.round((done / totalSize) * 100)}%`);
    }
  }

  // Flush any partial final piece.
  const pending = pieceHash.digest();
  if (pending.length > 0 && pieceRemaining < pieceLength) {
    pieceBufs.push(pending);
  }

  const pieces = Buffer.concat(pieceBufs);
  return { pieces, pieceLength, totalSize };
}

function readChunk(stream, n) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let got = 0;
    stream.on("data", (c) => {
      chunks.push(c);
      got += c.length;
      if (got >= n) {
        stream.removeAllListeners("data");
        stream.removeAllListeners("end");
        stream.removeAllListeners("error");
        resolve(Buffer.concat(chunks).slice(0, n));
      }
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Build a .torrent buffer.
 * Returns { torrentBuffer, infohash, infoBuffer }.
 */
function buildTorrent(files, pieceLength, pieces, totalSize, cfg, announceTiers) {
  const announce = String(cfg.torrent.announce || "");
  const privateFlag = cfg.torrent.private !== false ? 1 : 0;
  const createdBy = cfg.torrent.created_by || "0dayfiles-upload-helper-ultra";
  const comment = cfg.torrent.comment || "";
  const encoding = "UTF-8";

  const info = {
    name: path.basename(files[0] ? files[0].relPath.split("/")[0] : "release"),
    "piece length": pieceLength,
    pieces,
    private: privateFlag,
  };

  if (files.length === 1) {
    info.length = files[0].size;
  } else {
    info.files = files.map((f) => ({
      path: f.relPath.split("/"),
      length: f.size,
    }));
  }

  const infoBuffer = bencode.encode(info);
  const infohash = sha1(infoBuffer).toString("hex").toLowerCase();

  // Build announce-list tiers.
  const announceList = [[announce]];
  if (announceTiers && announceTiers.length) {
    for (const tier of announceTiers) {
      const t = String(tier).trim();
      if (t) announceList.push([t]);
    }
  }

  // NOTE: info is passed as a nested object (not a pre-encoded Buffer) so
  // bencode encodes it as a proper dictionary — this keeps verification
  // deterministic and matches the .torrent spec (info is a bencoded dict).
  const torrent = {
    announce,
    "announce-list": announceList,
    "creation date": Math.floor(Date.now() / 1000),
    "created by": createdBy,
    comment,
    encoding,
    info,
  };

  const torrentBuffer = bencode.encode(torrent);
  return { torrentBuffer, infohash, infoBuffer };
}

/**
 * Create a .torrent for a release folder.
 * Writes <slug>.torrent to outputDir (default: <release>-output/ beside source).
 * Returns { torrentPath, infohash, pieceLength, totalSize }.
 */
async function createTorrent(sourceDir, outputDir, cfg, { log } = {}) {
  const files = collectFiles(sourceDir, cfg);
  if (files.length === 0) {
    throw new Error("no files to hash - release folder is empty or all excluded");
  }

  const pieceLength = cfg.torrent.piece_length || defaultPieceLength(
    files.reduce((s, f) => s + f.size, 0)
  );

  if (log) log(`hashing ${files.length} files, piece length ${pieceLength}`);
  const { pieces, totalSize } = await hashPieces(files, pieceLength, { log });

  const announceTiers = cfg.torrent.announce_tiers || [];
  const { torrentBuffer, infohash } = buildTorrent(
    files, pieceLength, pieces, totalSize, cfg, announceTiers
  );

  const outDir = outputDir || path.join(path.dirname(sourceDir), `${path.basename(sourceDir)}-output`);
  fs.mkdirSync(outDir, { recursive: true });
  const slug = files[0].relPath.split("/")[0] || path.basename(sourceDir);
  const torrentPath = path.join(outDir, `${slug}.torrent`);
  fs.writeFileSync(torrentPath, torrentBuffer);

  if (log) log(`torrent written: ${path.basename(torrentPath)} (infohash ${infohash})`);
  return { torrentPath, infohash, pieceLength, totalSize };
}

/**
 * Cross-seed: build a .torrent from an existing .torrent's metadata.
 * Reuses file list, sizes, piece hashes, infohash; only announce changes.
 */
function crossSeed(sourceTorrentPath, outputDir, cfg) {
  const raw = fs.readFileSync(sourceTorrentPath);
  const decoded = bencode.decode(raw);
  const info = decoded.info;

  const pieceLength = info["piece length"];
  const pieces = info.pieces;
  const totalSize = info.length || info.files.reduce((s, f) => s + f.length, 0);
  const infohash = sha1(bencode.encode(info)).toString("hex").toLowerCase();

  const announce = String(cfg.torrent.announce || "");
  const announceTiers = cfg.torrent.announce_tiers || [];
  const announceList = [[announce]];
  if (announceTiers.length) {
    for (const t of announceTiers) {
      const tt = String(t).trim();
      if (tt) announceList.push([tt]);
    }
  }

  const torrent = {
    announce,
    "announce-list": announceList,
    "creation date": Math.floor(Date.now() / 1000),
    "created by": cfg.torrent.created_by || "0dayfiles-upload-helper-ultra",
    comment: cfg.torrent.comment || "",
    encoding: "UTF-8",
    info,
  };

  const torrentBuffer = bencode.encode(torrent);
  const outDir = outputDir || path.join(path.dirname(sourceTorrentPath), `${path.basename(sourceTorrentPath, ".torrent")}-output`);
  fs.mkdirSync(outDir, { recursive: true });
  const slug = path.basename(sourceTorrentPath, ".torrent");
  const torrentPath = path.join(outDir, `${slug}.torrent`);
  fs.writeFileSync(torrentPath, torrentBuffer);

  return { torrentPath, infohash, pieceLength, totalSize };
}

/** Verify a .torrent by re-hashing the source and comparing. Returns { ok, infohash, matches }. */
async function verifyTorrentFile(torrentPath, sourceDir, cfg, { log } = {}) {
  const raw = fs.readFileSync(torrentPath);
  const decoded = bencode.decode(raw);
  const info = decoded.info;
  const expectedHash = sha1(bencode.encode(info)).toString("hex").toLowerCase();
  const pieceLength = info["piece length"];

  const files = collectFiles(sourceDir, cfg);
  const { pieces } = await hashPieces(files, pieceLength, { log });
  const actualPieces = pieces.toString("hex");
  const expectedPieces = info.pieces.toString("hex"); // Buffer preserved exactly

  const matches = actualPieces === expectedPieces;
  return {
    ok: matches,
    infohash: expectedHash,
    matches,
    pieceCount: info.pieces.length / 20,
  };
}

module.exports = {
  createTorrent,
  crossSeed,
  verifyTorrentFile,
  collectFiles,
  hashPieces,
  defaultPieceLength,
  naturalCompare,
  sha1,
};
