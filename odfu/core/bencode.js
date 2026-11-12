"use strict";

/*!
 * Minimal BitTorrent bencode encoder/decoder.
 *
 * Byte strings are preserved as Buffer (piece hashes are arbitrary bytes and
 * must not be lossily transcoded through UTF-8). Dict keys are converted to
 * JS strings (torrent keys are always valid UTF-8).
 */

const { TextEncoder, TextDecoder } = require("util");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(value) {
  if (value === null || value === undefined) throw new Error("cannot bencode null/undefined");
  if (Buffer.isBuffer(value)) return encodeBytes(value);
  if (typeof value === "string") return encodeString(value);
  if (typeof value === "number") return encodeInt(value);
  if (Array.isArray(value)) return encodeList(value);
  if (typeof value === "object") return encodeDict(value);
  throw new Error(`cannot bencode type ${typeof value}`);
}

function encodeString(s) {
  const buf = encoder.encode(s);
  return Buffer.concat([Buffer.from(String(buf.length) + ":"), buf]);
}

function encodeBytes(buf) {
  return Buffer.concat([Buffer.from(String(buf.length) + ":"), buf]);
}

function encodeInt(n) {
  if (!Number.isInteger(n)) throw new Error(`bencode int must be integer, got ${n}`);
  return Buffer.from(`i${n}e`);
}

function encodeList(items) {
  const parts = [Buffer.from("l")];
  for (const item of items) parts.push(encode(item));
  parts.push(Buffer.from("e"));
  return Buffer.concat(parts);
}

function encodeDict(obj) {
  const keys = Object.keys(obj).sort((a, b) => {
    const ca = encoder.encode(a);
    const cb = encoder.encode(b);
    const len = Math.min(ca.length, cb.length);
    for (let i = 0; i < len; i++) {
      if (ca[i] !== cb[i]) return ca[i] - cb[i];
    }
    return ca.length - cb.length;
  });
  const parts = [Buffer.from("d")];
  for (const key of keys) {
    parts.push(encodeString(key));
    parts.push(encode(obj[key]));
  }
  parts.push(Buffer.from("e"));
  return Buffer.concat(parts);
}

function decode(input, offset = 0) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return decodeBuffer(buf, offset).value;
}

function decodeBuffer(buf, offset = 0) {
  const c = buf[offset];
  if (c === 0x64) return decodeDict(buf, offset); // 'd' — consume opener here
  if (c === 0x6c) return decodeList(buf, offset); // 'l' — consume opener here
  if (c === 0x69) return decodeInt(buf, offset); // 'i' — consume opener here
  if (c >= 0x30 && c <= 0x39) return decodeString(buf, offset); // digit -> byte string (Buffer)
  throw new Error(`unexpected bencode byte 0x${c.toString(16)} at offset ${offset}`);
}

function decodeString(buf, offset) {
  const colon = buf.indexOf(0x3a, offset); // ':'
  if (colon === -1) throw new Error("malformed bencode string: no colon");
  const len = Number(buf.slice(offset, colon).toString("utf8"));
  if (!Number.isInteger(len) || len < 0) throw new Error("invalid bencode string length");
  const start = colon + 1;
  const end = start + len;
  if (end > buf.length) throw new Error("bencode string exceeds buffer");
  const raw = buf.slice(start, end); // Buffer — preserve arbitrary bytes
  return { value: raw, bytesConsumed: end - offset };
}

function decodeStringToText(buf, offset) {
  const res = decodeString(buf, offset);
  return { value: decoder.decode(res.value), bytesConsumed: res.bytesConsumed };
}

function decodeInt(buf, offset) {
  // offset points at 'i'
  const end = buf.indexOf(0x65, offset); // 'e'
  if (end === -1) throw new Error("malformed bencode integer: no end");
  const text = buf.slice(offset + 1, end).toString("utf8");
  const n = Number(text);
  if (!Number.isInteger(n) || text !== String(n)) throw new Error(`invalid bencode integer: ${text}`);
  return { value: n, bytesConsumed: end - offset + 1 };
}

function decodeList(buf, offset) {
  // offset points at 'l'; consume it, then read items until 'e'
  let pos = offset + 1;
  const items = [];
  while (buf[pos] !== 0x65) {
    const res = decodeBuffer(buf, pos);
    items.push(res.value);
    pos += res.bytesConsumed;
  }
  return { value: items, bytesConsumed: pos - offset + 1 };
}

function decodeDict(buf, offset) {
  // offset points at 'd'; consume it, then read key/value pairs until 'e'
  let pos = offset + 1;
  const obj = {};
  while (buf[pos] !== 0x65) {
    const keyRes = decodeBuffer(buf, pos);
    pos += keyRes.bytesConsumed;
    const valRes = decodeBuffer(buf, pos);
    pos += valRes.bytesConsumed;
    obj[keyRes.value.toString("utf8")] = valRes.value; // keys -> JS string, values -> Buffer/nested
  }
  return { value: obj, bytesConsumed: pos - offset + 1 };
}

module.exports = { encode, decode, decodeStringToText };
