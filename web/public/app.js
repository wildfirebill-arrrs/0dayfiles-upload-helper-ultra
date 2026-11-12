"use strict";

/* 0dayfiles Upload Helper — web UI frontend (vanilla JS, Fetch API) */

const API = ""; // same-origin
let pollTimer = null;
let selectedPath = null;
let polling = false;

// --- helpers ---------------------------------------------------------------
function $(id) { return document.getElementById(id); }
function esc(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  const b = Number(bytes);
  if (b < 1024) return b + " B";
  const k = b / 1024;
  if (k < 1024) return k.toFixed(1) + " KB";
  const m = k / 1024;
  if (m < 1024) return m.toFixed(1) + " MB";
  return (m / 1024).toFixed(2) + " GB";
}
function fmtTime(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}
function showPanel(name) {
  document.querySelectorAll(".panel").forEach((p) => p.style.display = "none");
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  $("panel-" + name).style.display = "block";
  document.querySelector(".tab[data-tab='" + name + "']").classList.add("active");
}
function setStatus(msg) { $("status").textContent = msg; }

// --- config ----------------------------------------------------------------
async function loadConfig() {
  try {
    const r = await fetch(API + "/api/config");
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "config load failed");
    const c = j.config;
    $("meta").textContent =
      "bind: " + c.web.bind + ":" + (c.web.port || "(unset)") +
      "  |  watch: " + (c.web.watch_folder || "(unset)") +
      "  |  announce: " + (c.torrent.announce || "(unset)");
    setStatus("ready");
    $("config-json").textContent = JSON.stringify(j.config, null, 2);
  } catch (err) {
    $("meta").textContent = "config unavailable";
    setStatus("error: " + err.message);
  }
}

// --- file browser ----------------------------------------------------------
async function browse(dir) {
  try {
    const url = API + "/api/browse" + (dir ? "?path=" + encodeURIComponent(dir) : "");
    const r = await fetch(url);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "browse failed");
    renderBrowser(j);
  } catch (err) {
    $("browser-tbody").innerHTML = "<tr><td colspan=5 class=empty>error: " + esc(err.message) + "</td></tr>";
  }
}
function renderBrowser(j) {
  $("path-input").value = j.path;
  $("breadcrumb").textContent = j.path;
  selectedPath = j.path;
  $("btn-up").disabled = !j.parent;
  const tbody = $("browser-tbody");
  tbody.innerHTML = "";

  const goUp = () => browse(j.parent || j.root);
  const enter = (entry) => browse(pathJoin(j.path, entry.name));
  const select = (entry) => {
    selectedPath = pathJoin(j.path, entry.name);
    $("build-source").value = selectedPath;
    showPanel("build");
    setStatus("source selected: " + esc(selectedPath));
  };

  if (j.entries.length === 0) {
    tbody.innerHTML = "<tr><td colspan=5 class=empty>(empty)</td></tr>";
  } else {
    for (const e of j.entries) {
      const tr = document.createElement("tr");
      const full = pathJoin(j.path, e.name);
      const isDir = e.isDir;
      const size = isDir ? "—" : fmtSize(e.size);
      const mtime = fmtTime(e.mtime);
      const cls = isDir ? "badge-dir" : "badge-file";
      const typeLabel = isDir ? "folder" : (e.ext || "file");
      tr.innerHTML =
        "<td>" +
        (isDir ? "<span class=badge-dir>[d]</span> " : "<span class=badge-file>[f]</span> ") +
        esc(e.name) + "</td>" +
        "<td><span class=" + cls + ">" + esc(typeLabel) + "</span></td>" +
        "<td>" + esc(size) + "</td>" +
        "<td>" + esc(mtime) + "</td>" +
        "<td>" +
        (isDir
          ? "<button class='btn small clickable' onclick=\"appEnter('" + escJs(full) + "')\">open</button>"
          : "<button class='btn small clickable' onclick=\"appSelect('" + escJs(full) + "')\">select</button>") +
        "</td></tr>";
      tbody.appendChild(tr);
    }
  }
  // expose callbacks on window for inline onclick
  window.appEnter = enter;
  window.appSelect = select;
}
function pathJoin(base, name) {
  return base === "/" ? "/" + name : base + "/" + name;
}
function escJs(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

// --- build -----------------------------------------------------------------
async function doBuild() {
  const source = $("build-source").value.trim();
  const crossSeed = $("build-cross-seed").checked;
  const watch = $("build-watch").checked;
  const submit = $("build-submit").checked;
  if (!source) return setStatus("enter a source path");

  const btn = $("btn-build");
  btn.disabled = true;
  btn.textContent = "building…";
  try {
    const endpoint = crossSeed ? "/api/cross-seed" : "/api/build";
    const body = crossSeed ? { torrentPath: source, watch } : { sourceDir: source, watch, submit };
    const r = await fetch(API + endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "build failed");
    setStatus("job enqueued: " + j.jobId);
    $("jobs-list-scroll").scrollTop = $("jobs-list-scroll").scrollHeight;
    startPolling();
  } catch (err) {
    setStatus("build error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Build";
  }
}

// --- jobs ------------------------------------------------------------------
async function loadJobs() {
  try {
    const r = await fetch(API + "/api/jobs");
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "jobs load failed");
    renderJobs(j.jobs || []);
  } catch (err) {
    $("jobs-tbody").innerHTML = "<tr><td colspan=7 class=empty>error: " + esc(err.message) + "</td></tr>";
  }
}
function renderJobs(jobs) {
  const tbody = $("jobs-tbody");
  const empty = $("jobs-empty");
  if (!jobs || jobs.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  tbody.innerHTML = "";
  for (const job of jobs) {
    const tr = document.createElement("tr");
    const statusClass = "pill " + (job.status || "queued");
    const resultHtml = job.result
      ? "<a href='#' class='clickable' onclick=\"appOpenResult('" + escJs(job.result.torrentPath || "") + "')\">" +
        esc(job.result.infohash || "torrent") +
        (job.result.watchTorrentPath ? " <span class=note>(watch)</span>" : "") +
        "</a>"
      : "—";
    const logs = (job.logs || []).slice(-3).join(" … ");
    tr.innerHTML =
      "<td class=job-id>" + esc(job.id) + "</td>" +
      "<td class=job-type>" + esc(job.type || "") + "</td>" +
      "<td><span class='" + statusClass + "'>" + esc(job.status || "") + "</span></td>" +
      "<td><div class=prog><div class=prog-fill style='width:" + (job.progress || 0) + "%'></div></div>" +
      " <span class=prog-pct>" + (job.progress || 0) + "%</span></td>" +
      "<td class=job-src>" + esc(job.sourceDir || "") + "</td>" +
      "<td class=job-result>" + resultHtml + "</td>" +
      "<td class=job-logs title='" + esc((job.logs || []).join("\n")) + "'>" + esc(logs) + "</td></tr>";
    tbody.appendChild(tr);
  }
}
function appOpenResult(torrentPath) {
  if (!torrentPath) return;
  setStatus("torrent: " + esc(torrentPath));
}
function startPolling() {
  if (polling) return;
  polling = true;
  pollJobs();
}
function stopPolling() {
  polling = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
async function pollJobs() {
  if (!polling) return;
  await loadJobs();
  // check if any job is still running/queued
  const tbody = $("jobs-tbody");
  let active = false;
  for (const cell of tbody.querySelectorAll(".pill")) {
    const s = cell.textContent;
    if (s === "queued" || s === "running") { active = true; break; }
  }
  if (active) {
    pollTimer = setInterval(pollJobs, 2000);
  } else {
    polling = false;
    pollTimer = null;
    setStatus("jobs idle");
  }
}

// --- releases --------------------------------------------------------------
async function loadReleases() {
  try {
    const r = await fetch(API + "/api/releases");
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "releases load failed");
    renderReleases(j.releases || []);
  } catch (err) {
    $("releases-tbody").innerHTML = "<tr><td colspan=6 class=empty>error: " + esc(err.message) + "</td></tr>";
  }
}
function renderReleases(list) {
  const tbody = $("releases-tbody");
  const empty = $("releases-empty");
  if (!list || list.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  tbody.innerHTML = "";
  for (const rel of list) {
    const tr = document.createElement("tr");
    const stateClass = "pill " + (rel.state || "unknown");
    const submitDisabled = rel.state !== "done" ? "disabled" : "";
    tr.innerHTML =
      "<td>" + esc(rel.title || rel.displayName || "") + "</td>" +
      "<td>" + esc(rel.category || "") + "</td>" +
      "<td>" + esc(rel.sizeHuman || "") + "</td>" +
      "<td><span class='" + stateClass + "'>" + esc(rel.state || "") + "</span></td>" +
      "<td class=job-id>" + esc(rel.infohash || "") + "</td>" +
      "<td>" +
      "<button class='btn small' " + submitDisabled + " onclick=\"appSubmitRelease('" + escJs(JSON.stringify(rel)) + "')\">submit</button> " +
      (rel.torrentPath ? "<a href='#' class='clickable' onclick=\"appOpenResult('" + escJs(rel.torrentPath) + "')\">torrent</a>" : "") +
      (rel.watchTorrentPath ? " <a href='#' class='clickable' onclick=\"appOpenResult('" + escJs(rel.watchTorrentPath) + "')\">watch</a>" : "") +
      "</td></tr>";
    tbody.appendChild(tr);
  }
}
async function appSubmitRelease(releaseJson) {
  try {
    const release = JSON.parse(releaseJson);
    const r = await fetch(API + "/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release, dryRun: false }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "submit failed");
    setStatus(j.message || "submitted");
    loadReleases();
    startPolling();
  } catch (err) {
    setStatus("submit error: " + err.message);
  }
}

// --- init ------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  // tabs
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => showPanel(t.dataset.tab));
  });

  // browser controls
  $("btn-up").addEventListener("click", () => {
    const p = $("path-input").value;
    browse(p ? pathDirname(p) : "");
  });
  function pathDirname(p) {
    const parts = p.split("/");
    parts.pop();
    return parts.join("/") || "/";
  }
  $("btn-go").addEventListener("click", () => browse($("path-input").value));
  $("path-input").addEventListener("keydown", (e) => { if (e.key === "Enter") browse(e.target.value); });

  // build controls
  $("btn-pick-source").addEventListener("click", () => {
    if (selectedPath) {
      $("build-source").value = selectedPath;
      showPanel("build");
    } else {
      setStatus("select a folder in the file browser first");
    }
  });
  $("btn-build").addEventListener("click", doBuild);

  // jobs
  $("btn-refresh-jobs").addEventListener("click", loadJobs);
  // releases
  $("btn-refresh-releases").addEventListener("click", loadReleases);

  await loadConfig();
  browse("");
  loadReleases();
  startPolling();
});
