"use strict";

const fs = require("fs");
const path = require("path");
const fetch = globalThis.fetch;

const HOSTS = [
  { name: "imgbb", keyField: "api_key", urlField: "api_url", defaultUrl: "https://api.imgbb.com/1/upload" },
  { name: "catbox", keyField: "catbox_userhash", urlField: null, defaultUrl: "https://catbox.moe/user/api.php" },
  { name: "imgcdn", keyField: "imgcdn_api_key", urlField: "imgcdn_api_url", defaultUrl: "https://imgcdn.dev/api/1/upload" },
  { name: "hotimg", keyField: "hotimg_api_key", urlField: "hotimg_api_url", defaultUrl: "https://hotimg.com/api/1/upload" },
  { name: "imghosting", keyField: "imghosting_api_key", urlField: "imghosting_api_url", defaultUrl: "https://api.imghosting.in/upload" },
  { name: "freeimage", keyField: "freeimage_api_key", urlField: "freeimage_api_url", defaultUrl: "https://freeimage.host/api/1/upload" },
];

class UploadedImage {
  constructor({ filePath, displayUrl, url, host, size } = {}) {
    this.filePath = filePath || "";
    this.displayUrl = displayUrl || "";
    this.url = url || "";
    this.host = host || "";
    this.size = size || 0;
    this.uploadedAt = new Date().toISOString();
  }
}

/**
 * Upload an image to the first available host in the provider chain.
 * Returns { success, image: UploadedImage, host, error }.
 */
async function uploadImage(filePath, imagebbConfig) {
  if (!fs.existsSync(filePath)) {
    return { success: false, error: "file not found", image: new UploadedImage({ filePath }) };
  }

  const provider = imagebbConfig.provider || "auto";
  const order = provider === "auto"
    ? ["imgbb", "catbox", "imgcdn", "hotimg", "imghosting", "freeimage"]
    : [provider];

  const lastError = [];
  for (const name of order) {
    const host = HOSTS.find((h) => h.name === name);
    if (!host) continue;

    try {
      const result = await uploadToHost(name, filePath, imagebbConfig, host);
      if (result.success) {
        return {
          success: true,
          image: new UploadedImage({
            filePath,
            displayUrl: result.displayUrl || result.url,
            url: result.url,
            host: name,
            size: fs.statSync(filePath).size,
          }),
          host: name,
        };
      }
      lastError.push(`${name}: ${result.error}`);
    } catch (err) {
      lastError.push(`${name}: ${err.message}`);
    }
  }

  return {
    success: false,
    error: lastError.join("; "),
    image: new UploadedImage({ filePath }),
  };
}

async function uploadToHost(name, filePath, cfg, host) {
  const key = cfg[host.keyField];
  if (!key && name !== "catbox") {
    return { success: false, error: "no API key" };
  }

  const url = cfg[host.urlField] || host.defaultUrl;
  const form = new globalThis.FormData();
  form.append("file", fs.createReadStream(filePath));
  form.append("type", "file");
  if (key) form.append("key", key);
  if (name === "catbox" && cfg.catboxUserhash) form.append("userhash", cfg.catboxUserhash);
  if (name === "catbox") {
    form.append("reqtype", "fileupload");
  }

  const timeoutMs = (imagebbConfig.timeout || 60) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      body: form,
      signal: controller.signal,
      headers: { "User-Agent": "0dayfiles-upload-helper-ultra" },
    });
    clearTimeout(timer);
    const text = await response.text();
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { success: false, error: "invalid response" };
    }

    // Normalize across hosts.
    if (name === "imgbb") {
      const img = data.data || {};
      return { success: true, url: img.url || img.display_url, displayUrl: img.url || img.display_url };
    }
    if (name === "catbox") {
      return { success: true, url: data.url || data, displayUrl: data.url || data };
    }
    if (name === "imgcdn") {
      return { success: true, url: data.url || data.image_url, displayUrl: data.url || data.image_url };
    }
    if (name === "hotimg") {
      return { success: true, url: data.url || data.image_url, displayUrl: data.url || data.image_url };
    }
    if (name === "imghosting") {
      return { success: true, url: data.url || data.image_url, displayUrl: data.url || data.image_url };
    }
    if (name === "freeimage") {
      return { success: true, url: data.url || data.image_url, displayUrl: data.url || data.image_url };
    }
    return { success: false, error: "unknown host response" };
  } catch (err) {
    clearTimeout(timer);
    return { success: false, error: err.message };
  }
}

/** Upload an array of image file paths. Returns results in input order. */
async function uploadImages(filePaths, imagebbConfig) {
  const results = [];
  for (const fp of filePaths) {
    results.push(await uploadImage(fp, imagebbConfig));
  }
  return results;
}

module.exports = { uploadImage, uploadImages, UploadedImage, HOSTS };
