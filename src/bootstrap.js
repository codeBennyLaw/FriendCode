"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const { Store, audit } = require("./store");
const { hashPassword } = require("./passwords");
async function askTerminal(prompt, hidden = false) {
  const sink = hidden ? new Writable({ write(_chunk, _encoding, done) { done(); } }) : process.stdout;
  const rl = readline.createInterface({ input: process.stdin, output: sink, terminal: true });
  if (hidden) process.stdout.write(prompt);
  try { return await rl.question(hidden ? "" : prompt); }
  finally { rl.close(); if (hidden) process.stdout.write("\n"); }
}
async function persistOwner(config, qq) {
  if (config.ownerFromEnvironment && config.ownerQq === qq) return;
  const file = path.join(config.root, ".env");
  let text = "";
  try { text = await fs.readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  text = text.replace(/^\s*OWNER_QQ\s*=.*$/gm, "").trimEnd();
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${text}\nOWNER_QQ=${qq}\n`.trimStart(), { mode: 0o600 });
  await fs.rename(temp, file);
  config.ownerQq = qq;
}
async function ensureOwner(config, { interactive = !!(process.stdin.isTTY && process.stdout.isTTY), ask = askTerminal } = {}) {
  const store = await new Store(config.dataDir).init();
  try {
    if (config.ownerQq && Object.hasOwn(store.usersDoc.users, config.ownerQq)) { await store.ensureInvite(config.registerCode, config.ownerQq); return; }
    let qq = config.ownerQq;
    // Upgrade compatibility: infer only a single explicitly existing owner, never guess by ordering.
    if (!qq) {
      const admins = Object.entries(store.usersDoc.users).filter(([, user]) => user.role === "admin");
      if (admins.length === 1) { await persistOwner(config, admins[0][0]); await store.ensureInvite(config.registerCode, config.ownerQq); return; }
    }
    if (!qq) {
      if (!interactive) throw new Error("首次启动请在交互终端运行 node server.js 创建站长，或提供 OWNER_QQ 和临时 OWNER_PASSWORD 环境变量。");
      do { qq = (await ask("首次启动 · 请输入站长 QQ（5–12 位数字）：")).trim(); } while (!/^\d{5,12}$/.test(qq));
    }
    if (Object.hasOwn(store.usersDoc.users, qq)) { await persistOwner(config, qq); await store.ensureInvite(config.registerCode, config.ownerQq); return; }
    let password = process.env.OWNER_PASSWORD || "";
    delete process.env.OWNER_PASSWORD;
    if (!password && interactive) {
      while (true) {
        password = await ask("设置站长密码（8–128 位，输入不回显）：", true);
        if (password.length < 8 || password.length > 128 || password.includes("\0")) { console.log("密码长度应为 8–128 位。"); continue; }
        if (password === await ask("再次输入站长密码：", true)) break;
        console.log("两次密码不一致，请重试。");
      }
    }
    if (password.length < 8 || password.length > 128 || password.includes("\0")) throw new Error("首次创建站长需要 8–128 位密码。请交互运行 node server.js，或提供临时 OWNER_PASSWORD 环境变量。");
    let registerCode = config.registerCode;
    if (!registerCode && interactive && !store.settingsDoc.inviteCodes.length) {
      while (true) {
        registerCode = (await ask("设置群验证码（8–128 位，留空自动生成）：", true)).trim();
        if (!registerCode || (registerCode.length >= 8 && registerCode.length <= 128 && !registerCode.includes("\0"))) break;
        console.log("验证码长度应为 8–128 位。");
      }
    }
    const passwordHash = await hashPassword(password);
    // Persist the private owner identifier before the account, so interrupted setup can safely resume.
    await persistOwner(config, qq);
    await store.mutate("users", doc => {
      if (Object.hasOwn(doc.users, qq)) throw new Error("账号已存在，请重新启动。");
      doc.users[qq] = { qq, passwordHash, nick: "站长", role: "admin" };
      audit(doc, qq, qq, "owner-created");
    }, { backup: true });
    await store.ensureInvite(registerCode, qq);
    console.log("站长账号和初始群验证码已设置。密码只保存为哈希，验证码可登录后台查看。");
  } finally { await store.close(); }
}
module.exports = { ensureOwner, persistOwner };
