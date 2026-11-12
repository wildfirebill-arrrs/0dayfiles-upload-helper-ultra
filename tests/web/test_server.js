"use strict";

// TAP test for odfu/web/server.js via node --test
const assert = require("node:assert");
const test = require("node:test");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fsp = require("fs/promises");

const { load } = require("../../odfu/core/config");
const { createServer } = require("../../odfu/web/server");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "odfu-server-test-"));

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
  return { status: res.status, json };
}

test("GET /api/config returns masked public config", async () => {
  const cfg = load();
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/config");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    assert.ok(json.config.web);
    assert.strictEqual(json.config.web.port, 0);
    assert.strictEqual(json.config.web.bind, "127.0.0.1");
    assert.strictEqual(json.config.web.watch_folder, "");
    assert.ok(
      json.config.tracker.api_token === "" ||
        json.config.tracker.api_token.startsWith("*"),
      "api_token should be masked"
    );
  } finally {
    await stopApp();
  }
});

test("GET /api/browse lists a directory and blocks traversal", async () => {
  const root = path.join(TMP, "browse-root");
  const sub = path.join(root, "Releases", "Movie.Name.2024");
  await fsp.mkdir(sub, { recursive: true });
  await fsp.writeFile(path.join(sub, "video.mkv"), Buffer.alloc(1000));
  await fsp.writeFile(path.join(sub, "notes.txt"), Buffer.alloc(50));

  const cfg = load();
  cfg.web.browse_root = root;
  await startApp(cfg);
  try {
    let { status, json } = await fetchJson(baseUrl + "/api/browse");
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.root, path.resolve(root));
    assert.ok(Array.isArray(json.entries));
    const names = json.entries.map((e) => e.name);
    assert.ok(names.includes("Releases"));

    ({ status, json } = await fetchJson(
      baseUrl + "/api/browse?path=" + encodeURIComponent(json.root + "/Releases")
    ));
    assert.strictEqual(status, 200);
    const innerNames = json.entries.map((e) => e.name);
    assert.ok(innerNames.includes("Movie.Name.2024"));

    // traversal blocked
    ({ status, json } = await fetchJson(
      baseUrl + "/api/browse?path=" + encodeURIComponent("../../../")
    ));
    assert.strictEqual(status, 400);
    assert.strictEqual(json.ok, false);
  } finally {
    await stopApp();
  }
});

test("POST /api/build rejects missing sourceDir with 400", async () => {
  const cfg = load();
  await startApp(cfg);
  try {
    const { status, json } = await fetchJson(baseUrl + "/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(json.ok, false);
  } finally {
    await stopApp();
  }
});

test("POST /api/build enqueues a job and returns a jobId", async () => {
  const cfg = load();
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const fake = path.join(TMP, "does-not-exist");
    const { status, json } = await fetchJson(baseUrl + "/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceDir: fake }),
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    assert.ok(typeof json.jobId === "string" && json.jobId.length > 0);
    assert.ok(["queued", "running"].includes(json.status));
  } finally {
    await stopApp();
  }
});

test("enqueued job appears in GET /api/jobs", async () => {
  const cfg = load();
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const fake = path.join(TMP, "also-missing");
    const enq = await fetchJson(baseUrl + "/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceDir: fake }),
    });
    assert.strictEqual(enq.status, 200);
    const jobId = enq.json.jobId;

    // Allow the queue processor a tick to register the job.
    await new Promise((r) => setTimeout(r, 50));

    const { status, json } = await fetchJson(baseUrl + "/api/jobs/" + jobId);
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    assert.strictEqual(json.job.id, jobId);
    assert.strictEqual(json.job.sourceDir, fake);
    assert.ok(["queued", "running", "done", "error"].includes(json.job.status));
  } finally {
    await stopApp();
  }
});

test("POST /api/cross-seed enqueues a job", async () => {
  const cfg = load();
  cfg.web.browse_root = TMP;
  await startApp(cfg);
  try {
    const fakeTorrent = path.join(TMP, "fake.torrent");
    await fsp.writeFile(fakeTorrent, Buffer.alloc(10));
    const { status, json } = await fetchJson(baseUrl + "/api/cross-seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ torrentPath: fakeTorrent }),
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(json.ok, true);
    assert.ok(typeof json.jobId === "string" && json.jobId.length > 0);
    assert.ok(["queued", "running"].includes(json.status));
  } finally {
    await stopApp();
  }
});
