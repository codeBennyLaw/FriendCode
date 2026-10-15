"use strict";
const { loadConfig } = require("./src/config");
const { ensureOwner } = require("./src/bootstrap");
const { createApplication } = require("./src/app");
async function main() {
  const config = loadConfig();
  await ensureOwner(config);
  const app = await createApplication(config);
  try {
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(config.port, config.host, resolve); });
  } catch (error) { await app.close(); throw error; }
  console.log(`FriendCode 已启动：http://${config.host}:${config.port}${config.basePath}/`);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
    if (stopping) return; stopping = true;
    try { await app.close(); process.exitCode = 0; }
    catch { console.error("服务关闭失败，请检查数据目录权限。"); process.exitCode = 1; }
  });
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
