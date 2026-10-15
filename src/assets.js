"use strict";
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const zlib = require("node:zlib");
const gzip = promisify(zlib.gzip), brotli = promisify(zlib.brotliCompress);
function representation(body, encoding = "identity") {
  return { body, encoding, etag: `"${crypto.createHash("sha256").update(body).digest("base64url")}"` };
}
function accepts(header, variants) {
  const qualities = new Map();
  for (const part of String(header || "").toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";"); if (!name) continue;
    const quality = params.find(value=>value.trim().startsWith("q="));
    const value = quality ? Number(quality.trim().slice(2)) : 1;
    qualities.set(name.trim(), Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  let best = null, score = -1;
  for (const encoding of ["br", "gzip", "identity"]) {
    if (!variants[encoding]) continue;
    const quality = qualities.has(encoding) ? qualities.get(encoding) : encoding === "identity" ? (qualities.get("*") === 0 ? 0 : .001) : (qualities.get("*") || 0);
    if (quality > 0 && quality > score) { score = quality; best = variants[encoding]; }
  }
  return best;
}
function matchesEtag(header, etag) {
  return String(header || "").split(",").some(value=>value.trim() === "*" || value.trim().replace(/^W\//, "") === etag);
}
class AssetCache {
  constructor({ maxBytes = 8 * 1024 * 1024, maxEntries = 128, maxFileBytes = 2 * 1024 * 1024 } = {}) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.maxFileBytes = maxFileBytes;
    this.entries = new Map(); this.pending = new Map(); this.bytes = 0;
    this.stats = { reads: 0, hits: 0, builds: 0 };
  }
  async get(file, { htmlBasePath = "", type = "" } = {}) {
    const stat = await fs.stat(file, { bigint: true });
    if (!stat.isFile()) throw Object.assign(new Error("Not a file"), { code:"ENOENT" });
    const signature = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}:${htmlBasePath}:${type}`;
    const cached = this.entries.get(file);
    if (cached?.signature === signature) { this.entries.delete(file); this.entries.set(file,cached); this.stats.hits++; return cached; }
    const key = `${file}\0${signature}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const build = this.build(file,signature,{htmlBasePath,type}); this.pending.set(key,build);
    try { return await build; } finally { this.pending.delete(key); }
  }
  async build(file, signature, { htmlBasePath, type }) {
    this.stats.reads++; let body = await fs.readFile(file);
    if (type.startsWith("text/html")) body = Buffer.from(body.toString("utf8").replaceAll("__BASE_PATH__",htmlBasePath));
    const variants = { identity: representation(body) };
    if (body.length >= 512 && body.length <= this.maxFileBytes && /^(text\/|application\/javascript)/.test(type)) {
      const [gz,br] = await Promise.all([gzip(body,{level:6}),brotli(body,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:4,[zlib.constants.BROTLI_PARAM_MODE]:zlib.constants.BROTLI_MODE_TEXT}})]);
      if (gz.length < body.length) variants.gzip = representation(gz,"gzip");
      if (br.length < body.length) variants.br = representation(br,"br");
    }
    const bytes = Object.values(variants).reduce((sum,item)=>sum+item.body.length,0);
    const entry = { signature, variants, bytes };
    this.stats.builds++;
    const old = this.entries.get(file); if(old){this.bytes-=old.bytes;this.entries.delete(file);}
    if (body.length <= this.maxFileBytes && bytes <= this.maxBytes) {
      while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
        const first = this.entries.keys().next().value; this.bytes-=this.entries.get(first).bytes; this.entries.delete(first);
      }
      this.entries.set(file,entry); this.bytes+=bytes;
    }
    return entry;
  }
  clear() { this.entries.clear(); this.bytes=0; }
}
module.exports = { AssetCache, accepts, matchesEtag };
