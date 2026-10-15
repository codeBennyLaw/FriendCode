"use strict";
const path = require("node:path");
const fs = require("node:fs");

function loadConfig() {
  const root = path.resolve(__dirname, "..");
  const ownerFromEnvironment = !!process.env.OWNER_QQ;
  const envFile = path.join(root, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const ownerQq = process.env.OWNER_QQ || "";
  if (ownerQq && !/^\d{5,12}$/.test(ownerQq)) throw new Error("请在私有 .env 中设置有效的 OWNER_QQ，站长身份只由此配置决定。");
  const basePath = (process.env.BASE_PATH || "").replace(/\/$/, "");
  if (basePath && !/^\/(?:[a-zA-Z0-9_-]+\/?)+$/.test(basePath)) throw new Error("BASE_PATH 必须是 /friendcode 形式的路径。");
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 无效。");
  const origin = process.env.PUBLIC_ORIGIN || "";
  if (origin && new URL(origin).origin !== origin) throw new Error("PUBLIC_ORIGIN 只能包含协议和域名（可带端口），不要带路径或尾斜杠。");
  if (origin && !/^https?:\/\//.test(origin)) throw new Error("PUBLIC_ORIGIN 必须使用 HTTP 或 HTTPS。");
  return {
    root, publicDir: path.join(root, "public"),
    dataDir: path.resolve(root, process.env.DATA_DIR || "."),
    host: process.env.HOST || "127.0.0.1", port, ownerQq, ownerFromEnvironment, basePath,
    registerCode: process.env.REGISTER_CODE || "", publicOrigin: origin,
    secureCookies: process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE !== "false" && (origin.startsWith("https:") || process.env.NODE_ENV === "production")),
    sessionTtl: 12 * 60 * 60 * 1000,
    trustProxy: process.env.TRUST_PROXY === "true",
  };
}
module.exports = { loadConfig };
