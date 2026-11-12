"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const AUTH_FILE = ".auth";
const SECRET_FILE = ".secret";

/**
 * Generate a random password (32 hex chars).
 */
function generatePassword() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Generate a random secret (64 hex chars) for cookie signing.
 */
function generateSecret() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Load or create auth credentials.
 * Returns { username, password, secret }.
 * If AUTH_PASS is provided, uses it; otherwise auto-generates and persists to .auth.
 */
function loadAuth(cfg) {
  const webCfg = (cfg && cfg.web) || {};
  let username = webCfg.auth_username || process.env.AUTH_USER || "admin";
  let password = webCfg.auth_password || process.env.AUTH_PASS || "";
  let secret = webCfg.auth_secret || process.env.AUTH_SECRET || "";

  // Auto-generate password if not set.
  if (!password) {
    const authPath = path.join(process.cwd(), AUTH_FILE);
    if (fs.existsSync(authPath)) {
      try {
        const saved = fs.readFileSync(authPath, "utf8").trim();
        if (saved) password = saved;
      } catch (_) {
        // fall through to generate
      }
    }
    if (!password) {
      password = generatePassword();
      try {
        fs.writeFileSync(authPath, password, { mode: 0o600 });
      } catch (_) {
        // best effort
      }
      console.log(`[odfu-auth] generated password: ${password}`);
      console.log(`[odfu-auth] saved to ${AUTH_FILE} (mode 0600). Set AUTH_PASS to override.`);
    }
  }

  // Auto-generate secret if not set.
  if (!secret) {
    const secretPath = path.join(process.cwd(), SECRET_FILE);
    if (fs.existsSync(secretPath)) {
      try {
        const saved = fs.readFileSync(secretPath, "utf8").trim();
        if (saved) secret = saved;
      } catch (_) {
        // fall through
      }
    }
    if (!secret) {
      secret = generateSecret();
      try {
        fs.writeFileSync(secretPath, secret, { mode: 0o600 });
      } catch (_) {
        // best effort
      }
    }
  }

  return { username, password, secret };
}

/**
 * Sign a value with HMAC-SHA256 using the secret.
 */
function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

/**
 * Create a signed session token.
 */
function createSessionToken(username, secret) {
  const payload = `${username}:${Date.now()}`;
  const sig = sign(payload, secret);
  return `${payload}:${sig}`;
}

/**
 * Verify a session token. Returns username if valid, null otherwise.
 */
function verifySessionToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(":");
  if (parts.length !== 3) return null;
  const [username, timestamp, sig] = parts;
  const payload = `${username}:${timestamp}`;
  const expected = sign(payload, secret);
  // Timing-safe comparison.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return null;
  // Check expiry (7 days).
  const age = Date.now() - Number(timestamp);
  if (Number.isNaN(age) || age < 0 || age > 7 * 24 * 60 * 60 * 1000) return null;
  return username;
}

/**
 * Parse cookies from a Cookie header string.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch (_) {
      cookies[key] = val;
    }
  }
  return cookies;
}

/**
 * Build a Set-Cookie header value for the session.
 */
function sessionCookie(token, secret, forceSecure) {
  const attrs = [`odfu_session=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=604800"];
  if (forceSecure) attrs.push("Secure");
  return attrs.join("; ");
}

module.exports = {
  AUTH_FILE,
  SECRET_FILE,
  loadAuth,
  sign,
  createSessionToken,
  verifySessionToken,
  parseCookies,
  sessionCookie,
  generatePassword,
  generateSecret,
};