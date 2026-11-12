#!/usr/bin/env node
"use strict";

const { load, configPath } = require("./odfu/core/config");
const { createServer } = require("./odfu/web/server");

const cfg = load();
const webCfg = cfg.web || {};

const port = Number(webCfg.port) || 0;
const bind = String(webCfg.bind || "127.0.0.1");

// Validate port: Ultra.cc assigns 5-digit ports; refuse default ports.
if (!port || port < 10000 || port > 65535) {
  console.error("[odfu-web] error: web.port is not set to a valid assigned 5-digit port.");
  console.error("[odfu-web]         edit config.toml (or set ODFU_WEB_PORT) to your assigned port, e.g. 21345.");
  console.error("[odfu-web]         binding to 127.0.0.1 only; Nginx should terminate HTTPS/auth.");
  process.exit(1);
}

const app = createServer(cfg);

// Security guard: validates port + auth credentials before binding.
app._odfuPortWarning();

const server = app.listen(port, bind, () => {
  const actual = server.address().port;
  console.log(`[odfu-web] listening on ${bind}:${actual}`);
  console.log(`[odfu-web] config loaded from ${configPath()}`);
  console.log(`[odfu-web] watch folder: ${webCfg.watch_folder || "(unset — .torrent written beside source)"}`);
  console.log(`[odfu-web] browse root: ${webCfg.browse_root || process.cwd()}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[odfu-web] error: port ${port} already in use`);
  } else {
    console.error(`[odfu-web] error: ${err.message}`);
  }
  process.exit(1);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
