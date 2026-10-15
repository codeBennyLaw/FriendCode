"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { loadConfig } = require("../src/config");
const { Store, atomicWrite, validateUsers, validateData, validateSettings } = require("../src/store");
const { hashPassword } = require("../src/passwords");
async function main() {
  const name = process.argv[2];
  if (!name || !/^[a-zA-Z0-9._-]+\.enc\.json$/.test(name) || !process.argv.includes("--confirm")) throw new Error("先停止服务，再执行 npm run restore -- <备份文件名.enc.json> --confirm。只传文件名，不传路径。");
  const config = loadConfig(), dir = path.join(config.dataDir, ".private-backups");
  const key = Buffer.from((await fs.readFile(path.join(dir, "backup.key"), "utf8")).trim(), "hex");
  const encrypted = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
  if (key.length !== 32 || encrypted.version !== 1) throw new Error("备份格式或密钥无效。");
  let snapshot;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "hex"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
    snapshot = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, "base64")), decipher.final()]).toString("utf8"));
    if (snapshot.rawFiles) snapshot = { users: JSON.parse(snapshot.rawFiles["user.json"] || '{"users":{}}'), data: JSON.parse(snapshot.rawFiles["data.json"] || '{"entries":[]}'), settings: JSON.parse(snapshot.rawFiles["settings.json"] || '{"inviteCodes":[]}') };
  } catch { throw new Error("备份解密或解析失败：请确认密钥匹配、文件未损坏。"); }
  validateUsers(snapshot.users); validateData(snapshot.data);
  snapshot.settings ||= { inviteCodes: [] }; validateSettings(snapshot.settings);
  const store = new Store(config.dataDir);
  await store.acquireLock();
  try {
    // Back up exact current bytes, including corrupt files, before replacing anything.
    const rawFiles = {};
    for (const file of ["user.json", "data.json", "settings.json"]) {
      try { rawFiles[file] = await fs.readFile(path.join(config.dataDir, file), "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; rawFiles[file] = null; }
    }
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify({ version: 1, rawFiles }), "utf8"), cipher.final()]);
    const safety = `before-restore-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.enc.json`;
    await atomicWrite(path.join(dir, safety), { version: 1, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: bytes.toString("base64") });
    for (const user of Object.values(snapshot.users.users)) if (Object.hasOwn(user, "password")) { user.passwordHash = await hashPassword(user.password); delete user.password; }
    const marker = path.join(config.dataDir, ".restore-pending.json");
    await atomicWrite(marker, { backup: name, startedAt: new Date().toISOString() });
    await atomicWrite(store.usersFile, snapshot.users);
    await atomicWrite(store.dataFile, snapshot.data);
    await atomicWrite(store.settingsFile, snapshot.settings);
    await fs.unlink(marker);
    console.log(`恢复完成。恢复前的安全备份：${safety}。请确认私有 OWNER_QQ 配置与目标站长一致后启动服务。`);
  } finally { await store.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
