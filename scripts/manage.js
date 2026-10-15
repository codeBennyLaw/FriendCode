"use strict";
const { loadConfig } = require("../src/config");
const { Store, audit } = require("../src/store");
const { hashPassword, randomPassword } = require("../src/passwords");
async function main() {
  const command = process.argv[2];
  const config = loadConfig();
  const store = await new Store(config.dataDir).init();
  try {
    if (command === "migrate") { console.log("密码迁移检查完成；已有好友码数据未修改。"); return; }
    if (command === "backup") { const file = await store.backup(); console.log(`加密备份已生成：.private-backups/${file}。请将备份与 backup.key 分开保管。`); return; }
    if (command === "owner-reset") {
      if (!config.ownerQq || !Object.hasOwn(store.usersDoc.users, config.ownerQq)) throw new Error("站长账号尚不存在，请先运行 node server.js 完成首次初始化。");
      const password = randomPassword(), passwordHash = await hashPassword(password);
      await store.mutate("users", doc => {
        doc.users[config.ownerQq].passwordHash = passwordHash;
        doc.users[config.ownerQq].mustChangePassword = true;
        audit(doc, config.ownerQq, config.ownerQq, "owner-recovery");
      }, { backup: true });
      console.log("站长密码已重置。以下临时密码只显示本次，请登录后立即修改：");
      console.log(password);
      return;
    }
    throw new Error("支持的命令：migrate、backup、owner-reset。请先停止正在运行的服务。");
  } finally { await store.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
