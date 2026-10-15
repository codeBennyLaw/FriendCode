"use strict";
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { HttpError } = require("./errors");
const scrypt = promisify(crypto.scrypt);
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
// One memory-hard operation at a time; bound the queue to avoid memory/CPU exhaustion.
let tail = Promise.resolve();
let pending = 0;
async function derive(password, salt) {
  if (pending >= 16) throw new HttpError(503, "当前验证请求较多，请稍后重试。");
  pending++;
  const job = tail.then(() => scrypt(password, salt, 32, OPTIONS));
  tail = job.catch(() => {});
  try { return await job; } finally { pending--; }
}
function validPasswordHash(value) {
  return typeof value === "string" && /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value);
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt}$${key.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  const valid = validPasswordHash(encoded);
  const parts = valid ? encoded.split("$") : ["", "", "", "", "0".repeat(32), "0".repeat(64)];
  const key = await derive(password, parts[4]);
  return crypto.timingSafeEqual(key, Buffer.from(parts[5], "hex")) && valid;
}
function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: 18 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}
function secureEqual(a, b) {
  const digest = value => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}
module.exports = { hashPassword, verifyPassword, validPasswordHash, randomPassword, secureEqual };
