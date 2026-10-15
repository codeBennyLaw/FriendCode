"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const files = ["server.js"];
function walk(dir) { for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const rel = path.join(dir, item.name); if (item.isDirectory()) walk(rel); else if (rel.endsWith(".js")) files.push(rel); } }
for (const dir of ["src", "scripts", "public/js", "tests"]) walk(dir);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
console.log(`Syntax checks passed (${files.length} JavaScript files).`);
