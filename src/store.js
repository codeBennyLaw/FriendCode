"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { hashPassword, validPasswordHash } = require("./passwords");

async function atomicWrite(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temp, file);
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
async function readDocument(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw new Error(`数据文件无法读取或解析：${path.basename(file)}。为避免丢失数据，已停止启动。`, { cause: error });
  }
}
function validateUsers(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !doc.users || typeof doc.users !== "object" || Array.isArray(doc.users)) throw new Error("账号数据结构无效。");
  for (const [qq, user] of Object.entries(doc.users)) {
    if (!/^\d{5,12}$/.test(qq) || !user || typeof user !== "object" || Array.isArray(user)) throw new Error("账号数据结构无效。");
    if (user.qq !== undefined && user.qq !== qq) throw new Error("账号标识不一致，请检查私有数据。");
    if (!(Object.hasOwn(user, "password") && typeof user.password === "string") && !validPasswordHash(user.passwordHash)) throw new Error("账号密码格式无效。");
  }
}
function validateData(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !Array.isArray(doc.entries)) throw new Error("好友码数据结构无效。");
  const ids = new Set();
  for (const entry of doc.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || !/^\d{5,12}$/.test(entry.qq)) throw new Error("好友码标识无效或重复。");
    ids.add(entry.id);
    for (const field of ["game", "server", "code"]) if (typeof entry[field] !== "string") throw new Error("好友码字段格式无效。");
  }
}
function validateSettings(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !Array.isArray(doc.inviteCodes)) throw new Error("验证码配置结构无效。");
  let active = 0;
  const ids = new Set();
  for (const code of doc.inviteCodes) {
    if (!code || typeof code.id !== "string" || ids.has(code.id) || typeof code.code !== "string" || !code.code || code.code.length > 128 || !Number.isFinite(Date.parse(code.startedAt)) || (code.endedAt !== null && (!Number.isFinite(Date.parse(code.endedAt)) || Date.parse(code.endedAt) < Date.parse(code.startedAt)))) throw new Error("验证码历史结构无效。");
    ids.add(code.id); if (code.endedAt === null) active++;
  }
  if (active > 1) throw new Error("验证码配置不能同时存在多个有效验证码。");
}
class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.usersFile = path.join(dataDir, "user.json");
    this.dataFile = path.join(dataDir, "data.json");
    this.settingsFile = path.join(dataDir, "settings.json");
    this.lockFile = path.join(dataDir, ".friendcode.lock");
    this.queue = Promise.resolve();
    this.closed = false;
  }
  async init({ migrate = true } = {}) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await this.acquireLock();
    try {
      const restoring = await fs.access(path.join(this.dir, ".restore-pending.json")).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
      if (restoring) throw new Error("检测到未完成的数据恢复，已停止启动。请重新运行原恢复命令完成恢复。");
      const usersExist = await fs.access(this.usersFile).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
      const dataExists = await fs.access(this.dataFile).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
      this.usersDoc = await readDocument(this.usersFile, { users: {} });
      this.dataDoc = await readDocument(this.dataFile, { entries: [] });
      this.settingsDoc = await readDocument(this.settingsFile, { inviteCodes: [] });
      validateUsers(this.usersDoc); validateData(this.dataDoc); validateSettings(this.settingsDoc);
      if (!usersExist && this.dataDoc.entries.length) throw new Error("账号文件缺失但已有好友码，为避免丢失关联，已停止启动。请恢复账号文件。");
      if (!dataExists && Object.keys(this.usersDoc.users).length) throw new Error("已有账号但好友码文件缺失，已停止启动。请先恢复 data.json。");
      if (!dataExists) await atomicWrite(this.dataFile, this.dataDoc);
      if (migrate) await this.migratePasswords();
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  async acquireLock() {
    try {
      const handle = await fs.open(this.lockFile, "wx", 0o600);
      this.lockToken = crypto.randomUUID();
      await handle.writeFile(JSON.stringify({ pid: process.pid, token: this.lockToken }));
      await handle.close();
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let lock;
      try { lock = JSON.parse(await fs.readFile(this.lockFile, "utf8")); } catch { throw new Error("数据目录存在无法识别的锁，请确认旧服务已停止后检查 .friendcode.lock。"); }
      if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) throw new Error("数据目录锁无效，请人工检查。");
      try { process.kill(lock.pid, 0); }
      catch (check) {
        if (check.code === "ESRCH") { await fs.unlink(this.lockFile); return this.acquireLock(); }
      }
      throw new Error("数据目录正在被另一进程使用。请停止旧服务，不要使用 cluster/多实例模式。");
    }
  }
  async migratePasswords() {
    const legacy = Object.values(this.usersDoc.users).filter(user => Object.hasOwn(user, "password"));
    if (!legacy.length) return 0;
    await this.backup("before-password-migration");
    const next = structuredClone(this.usersDoc);
    for (const user of Object.values(next.users)) {
      if (!Object.hasOwn(user, "password")) continue;
      // Keep the exact existing password usable; never normalize/truncate it during migration.
      user.passwordHash = await hashPassword(user.password);
      delete user.password;
    }
    await atomicWrite(this.usersFile, next);
    this.usersDoc = next;
    return legacy.length;
  }
  currentInvite() { return this.settingsDoc.inviteCodes.find(item => item.endedAt === null) || null; }
  async ensureInvite(seedCode, ownerQq) {
    if (this.settingsDoc.inviteCodes.length) return;
    const code = seedCode || crypto.randomBytes(12).toString("base64url");
    if (code.length > 128 || code.includes("\0")) throw new Error("初始群验证码无效。");
    await this.mutate("settings", doc => {
      if (doc.inviteCodes.length) return;
      doc.inviteCodes.push({ id: crypto.randomUUID(), code, startedAt: new Date().toISOString(), endedAt: null, createdBy: ownerQq, source: seedCode ? "initial-config" : "generated" });
    });
  }
  async backup(label = "manual") {
    const dir = path.join(this.dir, ".private-backups");
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const keyFile = path.join(dir, "backup.key");
    let key;
    try { key = Buffer.from((await fs.readFile(keyFile, "utf8")).trim(), "hex"); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      key = crypto.randomBytes(32);
      await fs.writeFile(keyFile, key.toString("hex"), { flag: "wx", mode: 0o600 });
    }
    if (key.length !== 32) throw new Error("备份密钥无效，已停止操作。");
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const payload = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), users: this.usersDoc, data: this.dataDoc, settings: this.settingsDoc });
    const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const name = `${label}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.enc.json`;
    await atomicWrite(path.join(dir, name), { version: 1, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: encrypted.toString("base64") });
    return name;
  }
  mutate(kind, updater, { backup = false } = {}) {
    const operation = this.queue.then(async () => {
      if (this.closed) throw new Error("Storage is closed");
      const key = { users: "usersDoc", data: "dataDoc", settings: "settingsDoc" }[kind];
      if (!key) throw new Error("Invalid storage kind");
      const next = structuredClone(this[key]);
      const result = await updater(next);
      if (backup) await this.backup(kind === "users" ? "before-account-change" : "before-entry-change");
      await atomicWrite({ users: this.usersFile, data: this.dataFile, settings: this.settingsFile }[kind], next);
      this[key] = next;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async close() {
    await this.queue;
    this.closed = true;
    if (!this.lockToken) return;
    try {
      const lock = JSON.parse(await fs.readFile(this.lockFile, "utf8"));
      if (lock.token === this.lockToken) await fs.unlink(this.lockFile);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.lockToken = null;
  }
}
function audit(doc, actor, target, action) {
  const logs = Array.isArray(doc.auditLogs) ? doc.auditLogs : [];
  logs.push({ id: crypto.randomUUID(), at: new Date().toISOString(), actor, target, action });
  doc.auditLogs = logs.slice(-500);
}
module.exports = { Store, atomicWrite, validateUsers, validateData, validateSettings, audit };
