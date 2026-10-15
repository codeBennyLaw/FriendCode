"use strict";
const crypto = require("node:crypto");
const { HttpError } = require("./errors");
const digest = token => crypto.createHash("sha256").update(token).digest("hex");
class Sessions {
  constructor(config) { this.config = config; this.items = new Map(); }
  cleanup() {
    const now = Date.now();
    for (const [key, session] of this.items) if (session.expires <= now) this.items.delete(key);
  }
  cookie(token, maxAge) {
    const { basePath = "", secureCookies } = this.config;
    return `fc_session=${token}; HttpOnly; SameSite=Lax; Path=${basePath}/; Max-Age=${maxAge}${secureCookies ? "; Secure" : ""}`;
  }
  issue(res, qq, user) {
    this.cleanup();
    const existing = [...this.items.entries()].filter(([, item]) => item.qq === qq);
    while (existing.length >= 5) this.items.delete(existing.shift()[0]);
    if (this.items.size >= 1000) throw new HttpError(503, "当前会话过多，请稍后再试。");
    const token = crypto.randomBytes(32).toString("base64url");
    const session = { qq, passwordHash: user.passwordHash, csrf: crypto.randomBytes(24).toString("base64url"), expires: Date.now() + this.config.sessionTtl };
    this.items.set(digest(token), session);
    res.setHeader("Set-Cookie", this.cookie(token, Math.floor(this.config.sessionTtl / 1000)));
    return session;
  }
  get(req, users) {
    const token = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("fc_session="))?.slice(11);
    if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
    const key = digest(token), session = this.items.get(key);
    if (!session) return null;
    if (session.expires <= Date.now() || users[session.qq]?.passwordHash !== session.passwordHash) { this.items.delete(key); return null; }
    return session;
  }
  revokeUser(qq) { for (const [key, session] of this.items) if (session.qq === qq) this.items.delete(key); }
  logout(req, res) {
    const token = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("fc_session="))?.slice(11);
    if (token) this.items.delete(digest(token));
    res.setHeader("Set-Cookie", this.cookie("", 0));
  }
}
class RateLimiter {
  constructor() { this.items = new Map(); }
  cleanup() { const now = Date.now(); for (const [key, item] of this.items) if (item.until <= now) this.items.delete(key); }
  hit(key, max, windowMs) {
    const now = Date.now();
    let item = this.items.get(key);
    if (!item || item.until <= now) {
      this.cleanup();
      if (this.items.size >= 5000) throw new HttpError(503, "请求较多，请稍后重试。");
      item = { count: 0, until: now + windowMs }; this.items.set(key, item);
    }
    if (++item.count > max) throw new HttpError(429, "操作过于频繁，请稍后重试。");
  }
  clear(key) { this.items.delete(key); }
}
module.exports = { Sessions, RateLimiter };
