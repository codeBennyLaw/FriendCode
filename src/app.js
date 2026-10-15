"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Store, audit } = require("./store");
const { AssetCache, accepts, matchesEtag } = require("./assets");
const { hashPassword, verifyPassword, randomPassword, secureEqual } = require("./passwords");
const { Sessions, RateLimiter } = require("./sessions");
const { assert, HttpError } = require("./errors");
const { GAMES } = require("../public/js/games");
const MIME = { ".woff2": "font/woff2", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const MINUTE = 60_000;
function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}
function securityHeaders(res, config) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://q.qlogo.cn data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (config.secureCookies) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}
function stringField(body, key, { min = 0, max = 200, trim = true } = {}) {
  assert(typeof body[key] === "string", 400, `${key} 必须是字符串。`);
  const value = trim ? body[key].trim() : body[key];
  assert(value.length >= min && value.length <= max && !value.includes("\0"), 400, `${key} 长度应为 ${min}–${max} 个字符。`);
  return value;
}
function qqField(body) { const qq = stringField(body, "qq", { min: 5, max: 12 }); assert(/^\d+$/.test(qq), 400, "请输入有效的 QQ 号。"); return qq; }
function passwordField(body, key = "password", creating = false) { return stringField(body, key, { min: creating ? 8 : 1, max: 128, trim: false }); }
function entryFields(body) {
  const game = stringField(body, "game", { min: 1, max: 100 });
  const server = stringField(body, "server", { min: 1, max: 50 });
  const definition = GAMES.find(item => item.name === game);
  assert(definition && definition.servers.includes(server), 400, "游戏或区域服务器无效。");
  return { game, server, code: stringField(body, "code", { min: 1, max: 120 }), note: body.note === undefined ? "" : stringField(body, "note", { max: 300 }) };
}
async function readBody(req) {
  assert(/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || ""), 415, "请使用 application/json。");
  return new Promise((resolve, reject) => {
    let size = 0, failed = false; const chunks = [];
    req.on("data", chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > 16 * 1024) { failed = true; chunks.length = 0; reject(new HttpError(413, "请求内容过大。")); return; }
      chunks.push(chunk);
    });
    req.on("error", () => { failed = true; reject(new HttpError(400, "请求读取失败。")); });
    req.on("aborted", () => { failed = true; reject(new HttpError(400, "请求已中断。")); });
    req.on("end", () => {
      if (failed) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        assert(body !== null && typeof body === "object" && !Array.isArray(body), 400, "请求体必须是 JSON 对象。");
        resolve(body);
      } catch (error) { reject(error instanceof HttpError ? error : new HttpError(400, "请求不是有效的 JSON。")); }
    });
  });
}
async function createApplication(config) {
  const store = await new Store(config.dataDir).init();
  try { await store.ensureInvite(config.registerCode, config.ownerQq); } catch (error) { await store.close(); throw error; }
  const sessions = new Sessions(config), limits = new RateLimiter(), assets = new AssetCache();
  const timer = setInterval(() => { sessions.cleanup(); limits.cleanup(); }, MINUTE); timer.unref();
  const publicUser = (user, qq) => ({ qq, nick: typeof user.nick === "string" ? user.nick : "", role: qq === config.ownerQq ? "admin" : "user", mustChangePassword: user.mustChangePassword === true });
  const publicUsers = () => Object.fromEntries(Object.entries(store.usersDoc.users).map(([qq, user]) => [qq, publicUser(user, qq)]));
  let cachedPublicData;
  function publicData() {
    if (cachedPublicData?.usersDoc === store.usersDoc && cachedPublicData?.dataDoc === store.dataDoc) return cachedPublicData;
    const value = {
      users: publicUsers(),
      entries: store.dataDoc.entries.map(entry => ({ ...entry, nick: store.usersDoc.users[entry.qq]?.nick ?? entry.nick ?? "", copyCount: Number.isSafeInteger(entry.copyCount) && entry.copyCount >= 0 ? entry.copyCount : 0 })),
    };
    const body = JSON.stringify({ ok: true, ...value });
    cachedPublicData = { usersDoc: store.usersDoc, dataDoc: store.dataDoc, value, body, revision: crypto.createHash("sha256").update(body).digest("base64url") };
    return cachedPublicData;
  }
  function auth(req, { write = false, owner = false, allowTemporary = false } = {}) {
    const session = sessions.get(req, store.usersDoc.users);
    assert(session, 401, "登录已过期，请重新登录。");
    if (write) assert(typeof req.headers["x-csrf-token"] === "string" && secureEqual(req.headers["x-csrf-token"], session.csrf), 403, "请求验证失败，请刷新页面后重试。");
    const user = store.usersDoc.users[session.qq];
    assert(allowTemporary || !user.mustChangePassword, 403, "请先修改临时密码，再使用其他功能。");
    if (owner) assert(session.qq === config.ownerQq, 403, "此操作仅限站长。");
    return { session, user, qq: session.qq };
  }
  function fresh(actor, users = store.usersDoc.users) { assert(users[actor.qq]?.passwordHash === actor.session.passwordHash && actor.session.expires > Date.now(), 401, "账号凭据已变更，请重新登录。"); }
  function ip(req) {
    if (config.trustProxy && typeof req.headers["x-forwarded-for"] === "string") return req.headers["x-forwarded-for"].split(",")[0].trim().slice(0, 64);
    return req.socket.remoteAddress || "unknown";
  }
  async function api(req, res, route) {
    if (req.method === "GET" && route === "/api/session") {
      const session = sessions.get(req, store.usersDoc.users);
      return json(res, 200, { ok: true, user: session ? publicUser(store.usersDoc.users[session.qq], session.qq) : null, csrfToken: session?.csrf || "", registrationOpen: !!store.currentInvite(), minPasswordLength: 8 });
    }
    if (req.method === "GET" && route === "/api/data") {
      auth(req);
      res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
      return res.end(publicData().body);
    }
    if (req.method === "GET" && route === "/api/sync") {
      const session = sessions.get(req,store.usersDoc.users);
      const user = session ? publicUser(store.usersDoc.users[session.qq],session.qq) : null;
      const summary = { ok:true, user, csrfToken:session?.csrf || "", registrationOpen:!!store.currentInvite(), minPasswordLength:8 };
      if (!user || user.mustChangePassword) return json(res,200,{...summary,changed:false,revision:null});
      const snapshot = publicData();
      const revision = new URL(req.url,"http://localhost").searchParams.get("revision");
      const changed = revision !== snapshot.revision;
      return json(res,200,{...summary,changed,revision:snapshot.revision,...(changed ? snapshot.value : {})});
    }
    if (req.method === "GET" && route === "/api/admin/users") {
      auth(req, { owner: true });
      const counts = new Map(); for (const entry of store.dataDoc.entries) counts.set(entry.qq, (counts.get(entry.qq) || 0) + 1);
      const users = Object.entries(store.usersDoc.users).map(([qq, user]) => ({ ...publicUser(user, qq), entryCount: counts.get(qq) || 0 }));
      const logs = Array.isArray(store.usersDoc.auditLogs) ? store.usersDoc.auditLogs.slice(-50).reverse() : [];
      return json(res, 200, { ok: true, users, logs, entryCount: store.dataDoc.entries.length });
    }
    if (req.method === "GET" && route === "/api/admin/invite-codes") {
      auth(req, { owner: true });
      return json(res, 200, { ok: true, inviteCodes: [...store.settingsDoc.inviteCodes].reverse() });
    }
    assert(["POST", "PATCH", "DELETE"].includes(req.method), 405, "不支持的请求方法。");
    assert(req.headers["x-friendcode-request"] === "1", 403, "请求来源验证失败。");
    const origin = req.headers.origin;
    const expectedOrigin = config.publicOrigin || `${config.secureCookies ? "https" : "http"}://${req.headers.host}`;
    assert(!origin || origin === expectedOrigin, 403, "不允许跨站请求。");
    assert(req.headers["sec-fetch-site"] !== "cross-site", 403, "不允许跨站请求。");
    limits.hit(`writes:${ip(req)}`, 120, MINUTE);
    const body = await readBody(req);
    if (req.method === "POST" && route === "/api/login") {
      const qq = qqField(body), password = passwordField(body);
      limits.hit(`login-ip:${ip(req)}`, 40, 15 * MINUTE);
      limits.hit(`login-user:${qq}`, 10, 15 * MINUTE);
      const user = store.usersDoc.users[qq];
      const valid = await verifyPassword(password, user?.passwordHash);
      assert(valid && store.usersDoc.users[qq]?.passwordHash === user.passwordHash, 401, "QQ 或密码错误。");
      limits.clear(`login-user:${qq}`);
      sessions.logout(req, res);
      const session = sessions.issue(res, qq, user);
      return json(res, 200, { ok: true, user: publicUser(user, qq), csrfToken: session.csrf });
    }
    if (req.method === "POST" && route === "/api/register") {
      limits.hit(`register:${ip(req)}`, 8, 60 * MINUTE);
      const invite = store.currentInvite();
      assert(invite, 403, "当前未开放注册，请联系站长。");
      const qq = qqField(body), password = passwordField(body, "password", true);
      const code = stringField(body, "code", { min: 1, max: 128, trim: false });
      assert(secureEqual(code, invite.code), 403, "群验证码不正确。");
      assert(qq !== config.ownerQq, 403, "站长账号只能通过服务器初始化或恢复。");
      assert(!Object.hasOwn(store.usersDoc.users, qq), 409, "该 QQ 已注册，请登录；忘记密码请联系站长。");
      const passwordHash = await hashPassword(password);
      const user = await store.mutate("users", doc => {
        assert(store.currentInvite()?.id === invite.id, 409, "群验证码刚刚更新，请向站长索取新验证码。");
        assert(!Object.hasOwn(doc.users, qq), 409, "该 QQ 已注册。");
        doc.users[qq] = { qq, passwordHash, nick: "", role: "user" };
        audit(doc, qq, qq, "register");
        return structuredClone(doc.users[qq]);
      });
      sessions.logout(req, res);
      const session = sessions.issue(res, qq, user);
      return json(res, 201, { ok: true, user: publicUser(user, qq), csrfToken: session.csrf });
    }
    if (req.method === "POST" && route === "/api/logout") {
      if (sessions.get(req, store.usersDoc.users)) auth(req, { write: true, allowTemporary: true });
      sessions.logout(req, res); return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/password") {
      const actor = auth(req, { write: true, allowTemporary: true });
      limits.hit(`password:${actor.qq}`, 10, 15 * MINUTE);
      const oldPassword = passwordField(body, "oldPassword"), newPassword = passwordField(body, "newPassword", true);
      assert(await verifyPassword(oldPassword, actor.user.passwordHash), 400, "当前密码不正确。");
      assert(oldPassword !== newPassword, 400, "新密码不能与当前密码相同。");
      const passwordHash = await hashPassword(newPassword);
      const user = await store.mutate("users", doc => {
        fresh(actor, doc.users);
        doc.users[actor.qq].passwordHash = passwordHash;
        delete doc.users[actor.qq].mustChangePassword;
        audit(doc, actor.qq, actor.qq, "password-change");
        return structuredClone(doc.users[actor.qq]);
      }, { backup: true });
      sessions.revokeUser(actor.qq);
      const session = sessions.issue(res, actor.qq, user);
      return json(res, 200, { ok: true, user: publicUser(user, actor.qq), csrfToken: session.csrf });
    }
    if (req.method === "PATCH" && route === "/api/me/nick") {
      const actor = auth(req, { write: true });
      const nick = stringField(body, "nick", { max: 20 });
      const user = await store.mutate("users", doc => { fresh(actor, doc.users); doc.users[actor.qq].nick = nick; return structuredClone(doc.users[actor.qq]); });
      return json(res, 200, { ok: true, user: publicUser(user, actor.qq) });
    }
    if (req.method === "POST" && route === "/api/admin/invite-codes") {
      const actor = auth(req, { write: true, owner: true });
      limits.hit(`invite:${actor.qq}`, 10, 15 * MINUTE);
      const code = body.code === undefined || body.code === "" ? crypto.randomBytes(12).toString("base64url") : stringField(body, "code", { min: 8, max: 128 });
      const invite = await store.mutate("settings", doc => {
        fresh(actor);
        assert(!doc.inviteCodes.some(item => secureEqual(item.code, code)), 409, "请使用一个未使用过的新验证码。");
        const now = new Date().toISOString();
        for (const item of doc.inviteCodes) if (item.endedAt === null) item.endedAt = now;
        const item = { id: crypto.randomUUID(), code, startedAt: now, endedAt: null, createdBy: actor.qq, source: "owner-rotation" };
        doc.inviteCodes.push(item); return item;
      }, { backup: true });
      return json(res, 201, { ok: true, inviteCode: invite });
    }
    const resetMatch = route.match(/^\/api\/admin\/users\/(\d{5,12})\/reset-password$/);
    if (req.method === "POST" && resetMatch) {
      const actor = auth(req, { write: true, owner: true });
      limits.hit(`reset:${actor.qq}`, 20, 15 * MINUTE);
      const qq = resetMatch[1];
      assert(qq !== config.ownerQq, 400, "站长请使用修改密码；忘记密码时通过服务器恢复命令处理。");
      assert(Object.hasOwn(store.usersDoc.users, qq), 404, "账号不存在。");
      const password = randomPassword(), passwordHash = await hashPassword(password);
      await store.mutate("users", doc => {
        fresh(actor, doc.users);
        assert(Object.hasOwn(doc.users, qq), 404, "账号不存在。");
        doc.users[qq].passwordHash = passwordHash;
        doc.users[qq].mustChangePassword = true;
        audit(doc, actor.qq, qq, "password-reset");
      }, { backup: true });
      sessions.revokeUser(qq);
      return json(res, 200, { ok: true, qq, temporaryPassword: password });
    }
    if (req.method === "POST" && route === "/api/entries") {
      const actor = auth(req, { write: true });
      assert(!Object.hasOwn(body, "entries"), 400, "不再支持整表覆盖，请刷新页面。");
      const fields = entryFields(body);
      const entry = await store.mutate("data", doc => {
        fresh(actor);
        assert(doc.entries.filter(item => item.qq === actor.qq).length < 100, 409, "每个账号最多保存 100 条好友码。");
        const entry = { id: crypto.randomUUID(), qq: actor.qq, nick: store.usersDoc.users[actor.qq].nick || "", ...fields, copyCount: 0, createdAt: Date.now() };
        doc.entries.push(entry); return entry;
      });
      return json(res, 201, { ok: true, entry });
    }
    const entryMatch = route.match(/^\/api\/entries\/([^/]+)$/);
    if (entryMatch && ["PATCH", "DELETE"].includes(req.method)) {
      const actor = auth(req, { write: true });
      const id = entryMatch[1];
      const fields = req.method === "PATCH" ? entryFields(body) : null;
      if (req.method === "DELETE") {
        limits.hit(`delete:${actor.qq}`, 20, 15 * MINUTE);
        assert(await verifyPassword(passwordField(body), actor.user.passwordHash), 400, "密码不正确。");
      }
      const entry = await store.mutate("data", doc => {
        fresh(actor);
        const index = doc.entries.findIndex(item => item.id === id);
        assert(index !== -1, 404, "记录不存在，请刷新页面。");
        const entry = doc.entries[index];
        assert(actor.qq === config.ownerQq || entry.qq === actor.qq, 403, "只能操作自己的好友码。");
        if (fields) Object.assign(entry, fields);
        else doc.entries.splice(index, 1);
        return entry;
      }, { backup: true });
      return json(res, 200, { ok: true, entry: fields ? entry : undefined });
    }
    if (req.method === "POST" && route === "/api/copy") {
      const actor = auth(req, { write: true });
      const id = stringField(body, "id", { min: 1, max: 150 });
      limits.hit(`copy:${actor.qq}`, 60, MINUTE);
      const copyCount = await store.mutate("data", doc => {
        fresh(actor);
        const entry = doc.entries.find(item => item.id === id);
        assert(entry, 404, "记录不存在。");
        const count = Number.isSafeInteger(entry.copyCount) && entry.copyCount >= 0 ? entry.copyCount : 0;
        entry.copyCount = Math.min(Number.MAX_SAFE_INTEGER, count + 1); return entry.copyCount;
      });
      return json(res, 200, { ok: true, copyCount });
    }
    throw new HttpError(404, "接口不存在。");
  }
  async function staticFile(req, res, route) {
    assert(req.method === "GET" || req.method === "HEAD", 405, "不支持的请求方法。");
    if (route === "/admin") { res.writeHead(308, { Location: `${config.basePath}/admin/` }); return res.end(); }
    const rel = route === "/" ? "index.html" : route === "/admin/" ? "admin.html" : route.slice(1);
    assert(rel && !rel.split(/[\\/]/).some(part => part.startsWith(".") || !part), 404, "文件不存在。");
    const file = path.resolve(config.publicDir, rel), relative = path.relative(config.publicDir, file);
    assert(!relative.startsWith("..") && !path.isAbsolute(relative), 404, "文件不存在。");
    const type = MIME[path.extname(file)]; assert(type, 404, "文件不存在。");
    let entry;
    try {
      const real = await fs.realpath(file), relative = path.relative(config.publicDir, real);
      assert(!relative.startsWith("..") && !path.isAbsolute(relative), 404, "文件不存在。");
      entry = await assets.get(real, { htmlBasePath: config.basePath, type });
    } catch (error) { if(error instanceof HttpError)throw error; throw new HttpError(404, "文件不存在。"); }
    const selected = accepts(req.headers["accept-encoding"],entry.variants);
    assert(selected,406,"当前请求不接受可用的资源编码。");
    res.setHeader("Cache-Control","no-cache"); res.setHeader("ETag",selected.etag); res.setHeader("Vary","Accept-Encoding");
    if(selected.encoding!=="identity")res.setHeader("Content-Encoding",selected.encoding);
    if(matchesEtag(req.headers["if-none-match"],selected.etag)){res.writeHead(304);return res.end();}
    res.writeHead(200,{"Content-Type":type,"Content-Length":selected.body.length});
    res.end(req.method === "HEAD" ? undefined : selected.body);
  }

  const server = http.createServer(async (req, res) => {
    securityHeaders(res, config);
    res.setHeader("X-Request-Id", crypto.randomUUID());
    try {
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { throw new HttpError(400, "请求路径无效。"); }
      assert(!pathname.includes("\0") && !pathname.includes("\\"), 400, "请求路径无效。");
      const base = config.basePath || "";
      if (base && pathname === base) { res.writeHead(308, { Location: `${base}/` }); return res.end(); }
      assert(!base || pathname.startsWith(`${base}/`), 404, "页面不存在。");
      const route = pathname.slice(base.length);
      if (route.startsWith("/api/")) await api(req, res, route);
      else await staticFile(req, res, route);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(`[${res.getHeader("X-Request-Id")}] 请求处理失败 (${error.code || error.name})`);
      if (status === 429) res.setHeader("Retry-After", "60");
      json(res, status, { ok: false, error: status === 500 ? "服务器暂时无法保存或读取数据，请稍后重试。" : error.message });
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5000;
  server.on("clientError", (_error, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); });
  server.on("close", () => clearInterval(timer));
  async function close() { if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); clearInterval(timer); assets.clear(); cachedPublicData=null; await store.close(); }
  return { server, store, sessions, assets, close };
}
module.exports = { createApplication };
