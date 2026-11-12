"use strict";

// TAP test for odfu/web/server.js security features via node --test
const assert = require("node:assert");
const test = require("node:test");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fsp = require("fs/promises");

const { load } = require("../../odfu/core/config");
const { createServer } = require("../../odfu/web/server");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "odfu-sec-test-"));

test.after(async () => {
  await fsp.rm(TMP, { recursive: true, force: true });
});

let server;
let baseUrl;

async function startApp(cfg) {
  const app = createServer(cfg);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  baseUrl = "http://127.0.0.1:" + addr.port;
}

async function stopApp() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
    baseUrl = undefined;
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = { raw: text };
  }
  return { status: res.status, headers: res.headers, json };
}

function basicAuthHeader(username, password) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

// ---- Security: auth_required when credentials configured ----
test("web.js auth guard: refuses to start without credentials when auth_enabled", () => {
  const cfg = load();
  cfg.web.auth_enabled = true;
  cfg.web.auth_username = "";
  cfg.web.auth_password = "";
  cfg.web.browse_root = TMP;
  assert.throws(() => {
    const app = createServer(cfg);
    app._odfuPortWarning();
  }, /auth_username\/auth_password are not set/);
});

test("security headers present on responses", async () => {
  const cfg = load();
  cfg.web.auth_enabled = false; // no credentials for this test
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const { status, headers, json } = await fetchJson(baseUrl + "/api/config");
    assert.strictEqual(status, 200);
    assert.strictEqual(headers.get("x-content-type-options"), "nosniff");
    assert.strictEqual(headers.get("x-frame-options"), "DENY");
    assert.ok(headers.get("content-security-policy").includes("default-src"));
    assert.strictEqual(headers.get("referrer-policy"), "no-referrer");
  } finally {
    await stopApp();
  }
});

test("IP allowlist blocks non-listed IPs", async () => {
  const cfg = load();
  cfg.web.auth_enabled = false;
  cfg.web.browse_root = TMP;
  // Only allow an IP that is NOT 127.0.0.1 (tests run from localhost).
  cfg.web.ip_allowlist = ["10.255.255.255"];
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/config");
    assert.strictEqual(status, 403);
    assert.strictEqual(json.ok, false);
    assert.strictEqual(json.error, "IP not allowed");
  } finally {
    await stopApp();
  }
});

test("IP allowlist allows listed IPs", async () => {
  const cfg = load();
  cfg.web.auth_enabled = false;
  cfg.web.browse_root = TMP;
  cfg.web.ip_allowlist = ["127.0.0.1", "::1"];
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/config");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
  } finally {
    await stopApp();
  }
});

test("Basic Auth: 401 when credentials missing", async () => {
  const cfg = load();
  cfg.web.auth_enabled = true;
  cfg.web.auth_username = "odfu";
  cfg.web.auth_password = "s3cr3t";
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/config");
    assert.strictEqual(status, 401);
    assert.strictEqual(json.ok, false);
    assert.strictEqual(json.error, "authentication required");
  } finally {
    await stopApp();
  }
});

test("Basic Auth: 401 when credentials wrong", async () => {
  const cfg = load();
  cfg.web.auth_enabled = true;
  cfg.web.auth_username = "odfu";
  cfg.web.auth_password = "s3cr3t";
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/config", {
      headers: { Authorization: basicAuthHeader("odfu", "wrongpass") },
    });
    assert.strictEqual(status, 401);
    assert.strictEqual(json.ok, false);
    assert.strictEqual(json.error, "invalid credentials");
  } finally {
    await stopApp();
  }
});

test("Basic Auth: 200 when credentials correct", async () => {
  const cfg = load();
  cfg.web.auth_enabled = true;
  cfg.web.auth_username = "odfu";
  cfg.web.auth_password = "s3cr3t";
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/config", {
      headers: { Authorization: basicAuthHeader("odfu", "s3cr3t") },
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    // secrets masked
    assert.ok(
      json.config.web.auth_password === "" ||
        json.config.web.auth_password.startsWith("*")
    );
  } finally {
    await stopApp();
  }
});

test("CSRF: state-changing POST rejected without token", async () => {
  const cfg = load();
  cfg.web.auth_enabled = false;
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceDir: path.join(TMP, "does-not-exist") }),
    });
    assert.strictEqual(status, 403);
    assert.strictEqual(json.ok, false);
    assert.strictEqual(json.error, "CSRF token required");
  } finally {
    await stopApp();
  }
});

test("CSRF: state-changing POST accepted with valid token", async () => {
  const cfg = load();
  cfg.web.auth_enabled = false;
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    // First GET to obtain a CSRF token.
    const { headers } = await fetchJson(baseUrl + "/api/config");
    const token = headers.get("x-csrf-token");
    assert.ok(token, "expected a CSRF token header on GET");

    // Now POST with the token.
    const { status, json } = await fetchJson(baseUrl + "/api/build", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
      },
      body: JSON.stringify({ sourceDir: path.join(TMP, "does-not-exist") }),
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    assert.ok(typeof json.jobId === "string");
  } finally {
    await stopApp();
  }
});

test("Rate limiting: 429 after exceeding max requests", async () => {
  const cfg = load();
  cfg.web.auth_enabled = false;
  cfg.web.browse_root = TMP;
  cfg.web.rate_limit_max = 3;
  cfg.web.rate_limit_window_seconds = 1;
  await startApp(cfg);
  try {
    let statuses = [];
    for (let i = 0; i < 5; i++) {
      const { status } = await fetchJson(baseUrl + "/api/config");
      statuses.push(status);
    }
    // First 3 should be 200, then 429.
    assert.strictEqual(statuses[0], 200);
    assert.strictEqual(statuses[1], 200);
    assert.strictEqual(statuses[2], 200);
    assert.ok(statuses.includes(429), "expected a 429 among statuses: " + statuses.join(","));
  } finally {
    await stopApp();
  }
});
