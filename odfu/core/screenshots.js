"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const GRID_COLS = 6;
const GRID_ROWS = 6;
const THUMB_W = 320;

/**
 * Capture evenly-spread video frames (skipping head/tail fades) via ffmpeg.
 * Returns { success, frames: [ { path, timestamp } ], error }.
 */
async function captureFrames(videoFile, outputDir, { count = GRID_COLS * GRID_ROWS } = {}) {
  if (!fs.existsSync(videoFile)) {
    return { success: false, frames: [], error: "video file not found" };
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // Get duration via ffprobe.
  let durationSec = 0;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoFile],
      { timeout: 30000, encoding: "utf8" }
    );
    durationSec = Number(stdout.trim()) || 0;
  } catch (_) {
    return { success: false, frames: [], error: "ffprobe failed" };
  }
  if (!durationSec || durationSec < 10) {
    return { success: false, frames: [], error: "video too short" };
  }

  // Skip first/last 5% (fades, logos, credits).
  const start = durationSec * 0.05;
  const end = durationSec * 0.95;
  const span = end - start;
  const step = span / (count + 1);

  const frames = [];
  for (let i = 1; i <= count; i++) {
    const ts = start + step * i;
    const out = path.join(outputDir, `frame_${String(i).padStart(2, "0")}.jpg`);
    try {
      await execFileAsync(
        "ffmpeg",
        ["-v", "error", "-ss", String(ts), "-i", videoFile, "-frames:v", "1",
         "-qscale:v", "2", "-vf", `scale=${THUMB_W}:-1`, "-y", out],
        { timeout: 60000, encoding: "utf8" }
      );
      if (fs.existsSync(out) && fs.statSync(out).size > 0) {
        frames.push({ path: out, timestamp: ts });
      }
    } catch (_) {
      // skip failed frame
    }
  }

  return { success: frames.length > 0, frames, error: frames.length === 0 ? "no frames captured" : null };
}

/**
 * Build a 6x6 contact sheet from captured frames using ffmpeg tile filter.
 * Returns { success, sheetPath, error }.
 */
async function buildContactSheet(frames, outputDir, sheetName = "contact-sheet.jpg") {
  if (frames.length === 0) {
    return { success: false, sheetPath: null, error: "no frames" };
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const sheetPath = path.join(outputDir, sheetName);

  // Build ffmpeg inputs + filter.
  const inputs = [];
  const filterParts = [];
  for (let i = 0; i < frames.length; i++) {
    inputs.push("-i", frames[i].path);
    filterParts.push(`[${i}:v]scale=${THUMB_W}:-1:force_original_aspect_ratio=decrease,pad=${THUMB_W}:${THUMB_W}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`);
  }
  const inputsStr = inputs.join(" ");
  const inputsLabels = frames.map((_, i) => `[v${i}]`).join("");
  const filter = `${inputsLabels}x=0:y=0:inputs=${GRID_COLS * GRID_ROWS}:padding=4[vout]`;

  try {
    await execFileAsync(
      "ffmpeg",
      ["-v", "error", ...inputs,
       "-filter_complex", `${filterParts.join(";")};${filter}`,
       "-map", "[vout]", "-qscale:v", "2", "-y", sheetPath],
      { timeout: 120000, encoding: "utf8" }
    );
    if (fs.existsSync(sheetPath) && fs.statSync(sheetPath).size > 0) {
      return { success: true, sheetPath };
    }
    return { success: false, sheetPath: null, error: "sheet not written" };
  } catch (err) {
    return { success: false, sheetPath: null, error: err.message };
  }
}

module.exports = { captureFrames, buildContactSheet, GRID_COLS, GRID_ROWS, THUMB_W };
