"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");
const { createApplication } = require("../src/app");
const { Store } = require("../src/store");
const { verifyPassword } = require("../src/passwords");
const { ensureOwner } = require("../src/bootstrap");
const { GAMES } = require("../public/js/games");
const ROOT = path.resolve(__dirname, "..");
const OWNER = "10001", MEMBER = "10002", OTHER = "10003";
const fields = { game: GAMES[0].name, server: GAMES[0].servers[0], code: "fixture-code", note: "test" };
async function fixture(t, { seed = true, basePath = "" } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "friendcode-test-"));
  const config = { root: dir, publicDir: path.join(ROOT, "public"), dataDir: dir, ownerQq: OWNER, basePath, registerCode: "fixture-invite-code", secureCookies: false, sessionTtl: 60 * 60_000, trustProxy: false };
  const originalUsers = { users: {
    [OWNER]: { qq: OWNER, nick: "Owner", password: "owner-password", role: "admin" },
    [MEMBER]: { qq: MEMBER, nick: "Member", password: "old1", role: "user" },
    [OTHER]: { qq: OTHER, nick: "Other", password: "other-password", role: "admin" },
  } };
  const data = { entries: [{ id: "fixture-entry", qq: MEMBER, nick: "Member", ...fields, copyCount: 5, createdAt: 123456 }], extra: "preserve-me" };
  const dataText = JSON.stringify(data, null, 2) + "\n";
  if (seed) { await fs.writeFile(path.join(dir, "user.json"), JSON.stringify(originalUsers)); await fs.writeFile(path.join(dir, "data.json"), dataText); }
  let app;
  t.after(async () => {
    if (app) await app.close();
    // Only recursively remove the exact verified temporary fixture directory.
    const resolved = path.resolve(dir), tempRoot = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(tempRoot + path.sep) && path.basename(resolved).startsWith("friendcode-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  async function start() {
    app = await createApplication(config);
    await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
    return app;
  }
  function request(route, { method = "GET", body, auth, headers = {}, raw = false } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : raw ? body : JSON.stringify(body);
      const req = http.request({ hostname: "127.0.0.1", port: app.server.address().port, path: config.basePath + route, method, headers: { ...(data !== undefined ? { "Content-Type": "application/json", "X-FriendCode-Request": "1", "Content-Length": Buffer.byteLength(data) } : {}), ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}), ...headers } }, res => {
        let text = ""; res.on("data", chunk => { text += chunk; }); res.on("end", () => { let json; try { json = JSON.parse(text); } catch { /* Static response. */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
      }); req.on("error", reject); req.end(data);
    });
  }
  async function login(qq, password) {
    const result = await request("/api/login", { method: "POST", body: { qq, password } });
    assert.equal(result.status, 200, result.text);
    return { cookie: result.headers["set-cookie"][0].split(";")[0], csrf: result.json.csrfToken, result };
  }
  return { config, dir, start, request, login, originalUsers, dataText, app: () => app };
}
test("migration preserves all existing data and safely encrypts its backup", async t => {
  const f = await fixture(t); const app = await f.start();
  assert.equal(await fs.readFile(path.join(f.dir, "data.json"), "utf8"), f.dataText);
  assert.equal(Object.keys(app.store.usersDoc.users).length, 3);
  for (const [qq, user] of Object.entries(f.originalUsers.users)) {
    const migrated = app.store.usersDoc.users[qq];
    assert.equal(Object.hasOwn(migrated, "password"), false);
    assert.equal(migrated.nick, user.nick); assert.equal(migrated.role, user.role);
    assert.equal(await verifyPassword(user.password, migrated.passwordHash), true);
  }
  const backups = await fs.readdir(path.join(f.dir, ".private-backups"));
  const encrypted = JSON.parse(await fs.readFile(path.join(f.dir, ".private-backups", backups.find(name => name.endsWith(".enc.json"))), "utf8"));
  assert.equal(JSON.stringify(encrypted).includes("owner-password"), false);
  const key = Buffer.from(await fs.readFile(path.join(f.dir, ".private-backups/backup.key"), "utf8"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "hex")); decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
  const snapshot = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, "base64")), decipher.final()]).toString());
  assert.deepEqual(snapshot.users, f.originalUsers); assert.deepEqual(snapshot.data, JSON.parse(f.dataText));
  const bytes = await fs.readFile(path.join(f.dir, "user.json"), "utf8");
  assert.equal(await app.store.migratePasswords(), 0);
  assert.equal(await fs.readFile(path.join(f.dir, "user.json"), "utf8"), bytes);
});
test("API security, record ownership, concurrency and password recovery", async t => {
  const f = await fixture(t); await f.start();
  let owner = await f.login(OWNER, "owner-password"), member = await f.login(MEMBER, "old1");
  const other = await f.login(OTHER, "other-password");
  await t.test("only configured owner has backend authority, regardless of stored role", async () => {
    assert.equal(other.result.json.user.role, "user");
    assert.equal((await f.request("/api/admin/users", { auth: other })).status, 403);
    assert.equal((await f.request(`/api/admin/users/${MEMBER}/reset-password`, { method: "POST", body: {}, auth: other })).status, 403);
    const result = await f.request("/api/admin/users", { auth: owner }); assert.equal(result.status, 200);
    assert.equal(result.json.users.filter(user => user.role === "admin").length, 1);
    assert.equal(/passwordHash|scrypt\$|old1|owner-password/.test(result.text), false);
  });
  await t.test("private data is inaccessible without a real server session", async () => {
    assert.equal((await f.request("/api/data")).status, 401);
    assert.equal((await f.request("/api/data", { headers: { Cookie: `fc_s=${OWNER}` } })).status, 401);
    assert.equal((await f.request("/api/entries", { method: "POST", body: { entries: [] } })).status, 401);
  });
  await t.test("Cookie flags and CSRF protections", async () => {
    assert.match(owner.result.headers["set-cookie"][0], /HttpOnly; SameSite=Lax/);
    assert.equal((await f.request("/api/me/nick", { method: "PATCH", body: { nick: "hijack" }, auth: member, headers: { "X-CSRF-Token": "wrong" } })).status, 403);
    assert.equal((await f.request("/api/me/nick", { method: "PATCH", body: { nick: "hijack" }, auth: member, headers: { Origin: "https://evil.invalid" } })).status, 403);
    assert.equal((await f.request("/api/login", { method: "POST", body: { qq: OWNER, password: "owner-password" }, headers: { "X-FriendCode-Request": "" } })).status, 403);
  });
  await t.test("source files, data files and encoded paths are never served", async () => {
    for (const route of ["/user.json", "/%75ser.json", "/%73erver.js", "/data.json", "/README.md", "/.env", "/.git/config", "/.private-backups/backup.key", "/%2e%2e/user.json", "/css/%2e%2e/%2e%2e/user.json"]) {
      const result = await f.request(route); assert.notEqual(result.status, 200, route);
      assert.equal(result.text.includes("passwordHash"), false);
    }
    assert.equal((await f.request("/%ZZ")).status, 400);
    const result = await f.request("/"); assert.equal(result.status, 200); assert.match(result.headers["content-security-policy"], /script-src 'self'/);
    assert.equal(result.text.includes("__BASE_PATH__"), false);
    const cached = await f.request("/", { headers: { "If-None-Match": result.headers.etag } }); assert.equal(cached.status, 304);
  });
  await t.test("malformed, null, array, oversized and invalid fields never crash server", async () => {
    for (const body of ["null", "[]", "broken", '"text"']) assert.equal((await f.request("/api/entries", { method: "POST", body, raw: true, auth: member })).status, 400);
    assert.equal((await f.request("/api/entries", { method: "POST", body: { note: "x".repeat(20_000) }, auth: member })).status, 413);
    assert.equal((await f.request("/api/entries", { method: "POST", body: { ...fields, game: "unknown" }, auth: member })).status, 400);
    assert.equal((await f.request("/api/entries", { method: "POST", body: { entries: [] }, auth: member })).status, 400);
    assert.equal((await f.request("/api/session")).status, 200);
  });
  let ownEntry;
  await t.test("record metadata is server-owned and independent concurrent inserts are retained", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => f.request("/api/entries", { method: "POST", auth: member, body: { ...fields, code: `code-${i}`, qq: OWNER, role: "admin", copyCount: 999, createdAt: 0 } })));
    for (const result of results) { assert.equal(result.status, 201); assert.equal(result.json.entry.qq, MEMBER); assert.equal(result.json.entry.copyCount, 0); assert.ok(result.json.entry.createdAt > 0); }
    ownEntry = results[0].json.entry;
    const result = await f.request("/api/data", { auth: member }); assert.equal(result.json.entries.length, 6);
    assert.equal(/passwordHash|scrypt\$/.test(result.text), false);
    const copies = await Promise.all(Array.from({ length: 5 }, () => f.request("/api/copy", { method: "POST", body: { id: ownEntry.id }, auth: member })));
    assert.deepEqual(copies.map(result => result.json.copyCount).sort((a,b) => a-b), [1,2,3,4,5]);
  });
  await t.test("members cannot edit/delete others, owner can; nickname only affects self", async () => {
    assert.equal((await f.request(`/api/entries/${ownEntry.id}`, { method: "PATCH", body: fields, auth: other })).status, 403);
    assert.equal((await f.request(`/api/entries/${ownEntry.id}`, { method: "DELETE", body: { password: "other-password" }, auth: other })).status, 403);
    assert.equal((await f.request(`/api/entries/${ownEntry.id}`, { method: "DELETE", body: { password: "wrong" }, auth: owner })).status, 400);
    assert.equal((await f.request(`/api/entries/${ownEntry.id}`, { method: "PATCH", body: { ...fields, note: "owner edited" }, auth: owner })).status, 200);
    const result = await f.request("/api/me/nick", { method: "PATCH", body: { qq: OWNER, nick: '<script>alert("x")</script>' }, auth: member }); assert.equal(result.status, 400);
    assert.equal((await f.request("/api/me/nick", { method: "PATCH", body: { qq: OWNER, nick: "new-member-name" }, auth: member })).status, 200);
    assert.equal(f.app().store.usersDoc.users[OWNER].nick, "Owner");
    const snapshot = await f.request("/api/data", { auth: member }); assert.ok(snapshot.json.entries.filter(entry=>entry.qq===MEMBER).every(entry=>entry.nick==="new-member-name"));
  });
  let temporaryPassword;
  await t.test("reset invalidates sessions and passwords, preserves all profile/entry data, logs no password", async () => {
    const beforeData = await fs.readFile(path.join(f.dir, "data.json"), "utf8"), beforeNick = f.app().store.usersDoc.users[MEMBER].nick;
    const result = await f.request(`/api/admin/users/${MEMBER}/reset-password`, { method: "POST", body: {}, auth: owner }); assert.equal(result.status, 200);
    temporaryPassword = result.json.temporaryPassword; assert.match(temporaryPassword, /^[A-Za-z2-9]{18}$/); assert.equal(result.headers["cache-control"], "no-store");
    assert.equal((await f.request("/api/data", { auth: member })).status, 401);
    assert.equal((await f.request("/api/login", { method: "POST", body: { qq: MEMBER, password: "old1" } })).status, 401);
    assert.equal(await fs.readFile(path.join(f.dir, "data.json"), "utf8"), beforeData);
    assert.equal(f.app().store.usersDoc.users[MEMBER].nick, beforeNick);
    const accounts = await fs.readFile(path.join(f.dir, "user.json"), "utf8"); assert.equal(accounts.includes(temporaryPassword), false);
    assert.equal(f.app().store.usersDoc.auditLogs.at(-1).action, "password-reset");
    assert.equal((await f.request(`/api/admin/users/${OWNER}/reset-password`, { method: "POST", body: {}, auth: owner })).status, 400);
  });
  await t.test("temporary-password accounts must change password before accessing any group data", async () => {
    member = await f.login(MEMBER, temporaryPassword); assert.equal(member.result.json.user.mustChangePassword, true);
    assert.equal((await f.request("/api/data", { auth: member })).status, 403);
    assert.equal((await f.request("/api/entries", { method: "POST", body: fields, auth: member })).status, 403);
    const result = await f.request("/api/password", { method: "POST", body: { oldPassword: temporaryPassword, newPassword: "new-member-password" }, auth: member }); assert.equal(result.status, 200);
    assert.equal(result.json.user.mustChangePassword, false);
    assert.equal((await f.request("/api/data", { auth: member })).status, 401);
    member = { cookie: result.headers["set-cookie"][0].split(";")[0], csrf: result.json.csrfToken };
    assert.equal((await f.request("/api/data", { auth: member })).status, 200);
  });
  await t.test("group invitation required; owner cannot be registered; client role is ignored", async () => {
    assert.equal((await f.request("/api/register", { method: "POST", body: { qq: "10004", password: "test-password", code: "wrong" } })).status, 403);
    assert.equal((await f.request("/api/register", { method: "POST", body: { qq: OWNER, password: "test-password", code: f.config.registerCode } })).status, 403);
    const result = await f.request("/api/register", { method: "POST", body: { qq: "10004", password: "test-password", code: f.config.registerCode, role: "admin" } }); assert.equal(result.status, 201); assert.equal(result.json.user.role, "user");
    assert.equal((await f.request("/api/register", { method: "POST", body: { qq: "10004", password: "test-password", code: f.config.registerCode } })).status, 409);
  });
  await t.test("only owner sees or rotates invitation history; periods are contiguous and old codes stop working", async () => {
    assert.equal((await f.request("/api/admin/invite-codes",{auth:other})).status,403);
    assert.equal((await f.request("/api/admin/invite-codes",{method:"POST",body:{},auth:other})).status,403);
    const original=await f.request("/api/admin/invite-codes",{auth:owner}); assert.equal(original.json.inviteCodes[0].code,f.config.registerCode);
    const result=await f.request("/api/admin/invite-codes",{method:"POST",body:{code:"new-private-invite"},auth:owner}); assert.equal(result.status,201);
    const history=await f.request("/api/admin/invite-codes",{auth:owner}); assert.equal(history.json.inviteCodes.length,2);
    assert.equal(history.json.inviteCodes[0].endedAt,null);assert.equal(history.json.inviteCodes[1].endedAt,history.json.inviteCodes[0].startedAt);
    assert.equal((await f.request("/api/register",{method:"POST",body:{qq:"10005",password:"test-password",code:f.config.registerCode}})).status,403);
    assert.equal((await f.request("/api/register",{method:"POST",body:{qq:"10005",password:"test-password",code:"new-private-invite"}})).status,201);
    assert.equal((await f.request("/api/admin/invite-codes",{method:"POST",body:{code:f.config.registerCode},auth:owner})).status,409);
    const snapshot=await f.request("/api/data",{auth:owner});assert.equal(snapshot.text.includes("new-private-invite"),false);
    assert.equal((await f.request("/api/session")).text.includes("new-private-invite"),false);
  });
  await t.test("logout revokes session on the server", async () => {
    assert.equal((await f.request("/api/logout", { method: "POST", body: {}, auth: member })).status, 200);
    assert.equal((await f.request("/api/data", { auth: member })).status, 401);
  });
  await t.test("login failures are rate-limited without exhausting expensive hash queue", async () => {
    for(let i=0;i<10;i++) await f.request("/api/login", { method:"POST", body:{qq:OTHER,password:"wrong"} });
    const result=await f.request("/api/login",{method:"POST",body:{qq:OTHER,password:"wrong"}}); assert.equal(result.status,429); assert.ok(result.headers["retry-after"]);
  });
  await t.test("restarting preserves invitation history and ignores the stale initial seed", async () => {
    await f.app().close(); await f.start();
    const ownerAgain = await f.login(OWNER, "owner-password");
    const history = await f.request("/api/admin/invite-codes", { auth: ownerAgain });
    assert.equal(history.json.inviteCodes.length, 2); assert.equal(history.json.inviteCodes[0].code, "new-private-invite");
    assert.equal((await f.request("/api/data", { auth: owner })).status, 401);
  });
});
test("fresh non-interactive startup bootstraps the owner using temporary environment credentials", async t => {
  const f=await fixture(t,{seed:false}); f.config.ownerQq="";
  await assert.rejects(ensureOwner(f.config,{interactive:false}),/首次启动/);
  f.config.ownerQq=OWNER;
  const previous=process.env.OWNER_PASSWORD; process.env.OWNER_PASSWORD="bootstrap-password";
  try { await ensureOwner(f.config,{interactive:false}); } finally { if(previous===undefined)delete process.env.OWNER_PASSWORD;else process.env.OWNER_PASSWORD=previous; }
  assert.equal(f.config.ownerQq,OWNER); assert.match(await fs.readFile(path.join(f.dir,".env"),"utf8"),/OWNER_QQ=10001/);
  const users=JSON.parse(await fs.readFile(path.join(f.dir,"user.json"),"utf8")); assert.equal(await verifyPassword("bootstrap-password",users.users[OWNER].passwordHash),true);
  assert.equal(JSON.stringify(users).includes("bootstrap-password"),false);
  await ensureOwner(f.config,{interactive:false});
  assert.equal(await fs.readFile(path.join(f.dir,"user.json"),"utf8"),JSON.stringify(users,null,2)+"\n");
});
test("interactive first-run wizard asks for QQ and hidden, confirmed password", async t => {
  const f=await fixture(t,{seed:false});f.config.ownerQq="";
  f.config.registerCode="";
  const answers=[OWNER,"interactive-password","interactive-password","interactive-invite"], prompts=[];
  await ensureOwner(f.config,{interactive:true,ask:async(prompt,hidden)=>{prompts.push({prompt,hidden});return answers.shift();}});
  assert.deepEqual(prompts.map(item=>!!item.hidden),[false,true,true,true]);
  await f.start();assert.equal((await f.login(OWNER,"interactive-password")).result.json.user.role,"admin");
});
test("configured subpath serves correct assets, API routes and cookie path", async t=>{
  const f=await fixture(t,{basePath:"/group/friends"});await f.start();
  const index=await f.request("/");assert.match(index.text,/<base href="\/group\/friends\/"/);
  assert.equal((await f.request("/js/api.js")).status,200);
  const owner=await f.login(OWNER,"owner-password");assert.match(owner.result.headers["set-cookie"][0],/Path=\/group\/friends\//);
  assert.equal((await f.request("/admin")).headers.location,"/group/friends/admin/");
  assert.equal((await f.request("/admin/")).status,200);
});
test("corrupt storage fails closed without overwriting files; duplicate instances rejected",async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.dir,"user.json"),"broken-json");
  await assert.rejects(new Store(f.dir).init(),/停止启动/);
  assert.equal(await fs.readFile(path.join(f.dir,"user.json"),"utf8"),"broken-json");
  await fs.writeFile(path.join(f.dir,"user.json"),JSON.stringify(f.originalUsers));await f.start();
  await assert.rejects(new Store(f.dir).init(),/另一进程/);
});

test("offline backup, owner recovery and restore work without exposing or discarding data", async t => {
  const f = await fixture(t); const app = await f.start(); await app.close();
  const { spawnSync } = require("node:child_process");
  const run = (script, args = []) => spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { cwd: ROOT, env: { ...process.env, DATA_DIR: f.dir, OWNER_QQ: OWNER, REGISTER_CODE: "fixture-invite-code" }, encoding: "utf8", windowsHide: true });
  const before = await fs.readFile(path.join(f.dir, "data.json"), "utf8");
  const backup = run("manage.js", ["backup"]); assert.equal(backup.status, 0, backup.stderr);
  const names = await fs.readdir(path.join(f.dir, ".private-backups")); const name = names.find(item => item.startsWith("manual-") && item.endsWith(".enc.json")); assert.ok(name);
  const recovery = run("manage.js", ["owner-reset"]); assert.equal(recovery.status, 0, recovery.stderr);
  const temporary = recovery.stdout.trim().split(/\r?\n/).at(-1); assert.equal(temporary.length, 18);
  let users = JSON.parse(await fs.readFile(path.join(f.dir, "user.json"), "utf8")); assert.equal(users.users[OWNER].mustChangePassword, true); assert.equal(await verifyPassword(temporary, users.users[OWNER].passwordHash), true);
  assert.equal(await fs.readFile(path.join(f.dir, "data.json"), "utf8"), before);
  // Restoration must also be possible when the current files are corrupt.
  await fs.writeFile(path.join(f.dir, "data.json"), "corrupt-fixture");
  const restored = run("restore.js", [name, "--confirm"]); assert.equal(restored.status, 0, restored.stderr);
  users = JSON.parse(await fs.readFile(path.join(f.dir, "user.json"), "utf8")); assert.equal(await verifyPassword("owner-password", users.users[OWNER].passwordHash), true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dir, "data.json"), "utf8")), JSON.parse(before));
  assert.equal(users.users[MEMBER].nick, "Member");
});
test("missing account files cannot silently turn existing group records into a fresh installation", async t => {
  const f = await fixture(t); await fs.unlink(path.join(f.dir, "user.json"));
  await assert.rejects(new Store(f.dir).init(), /账号文件缺失/);
  assert.equal(await fs.readFile(path.join(f.dir, "data.json"), "utf8"), f.dataText);
});

test("environment-configured non-interactive setup does not require writing to the source .env", async t => {
  const f = await fixture(t, { seed: false }); f.config.ownerFromEnvironment = true;
  const previous = process.env.OWNER_PASSWORD; process.env.OWNER_PASSWORD = "readonly-root-password";
  try { await ensureOwner(f.config, { interactive: false }); } finally { if (previous === undefined) delete process.env.OWNER_PASSWORD; else process.env.OWNER_PASSWORD = previous; }
  await assert.rejects(fs.access(path.join(f.dir, ".env")), { code: "ENOENT" });
  const user = JSON.parse(await fs.readFile(path.join(f.dir, "user.json"), "utf8")).users[OWNER];
  assert.equal(await verifyPassword("readonly-root-password", user.passwordHash), true);
});

test("versioned sync combines authentication and data while unchanged polls omit the group payload", async t => {
  const f=await fixture(t);await f.start();const owner=await f.login(OWNER,"owner-password");
  const anonymous=await f.request("/api/sync");assert.equal(anonymous.status,200);assert.equal(anonymous.json.user,null);assert.equal(anonymous.json.entries,undefined);assert.equal(anonymous.json.users,undefined);
  const first=await f.request("/api/sync",{auth:owner});assert.equal(first.status,200);assert.equal(first.json.changed,true);assert.equal(first.json.entries.length,1);assert.match(first.json.revision,/^[a-zA-Z0-9_-]{43}$/);assert.equal(first.json.csrfToken,owner.csrf);assert.equal(first.headers["cache-control"],"no-store");
  const route="/api/sync?revision="+first.json.revision;
  const unchanged=await f.request(route,{auth:owner});assert.equal(unchanged.json.changed,false);assert.equal(unchanged.json.entries,undefined);assert.equal(unchanged.json.users,undefined);assert.equal(unchanged.json.user.qq,OWNER);assert.ok(unchanged.text.length<first.text.length);
  await f.app().store.mutate("users",doc=>{doc.auditLogs ||= [];doc.auditLogs.push({action:"test-only-audit"});});
  assert.equal((await f.request(route,{auth:owner})).json.changed,false,"private audit-only changes must not invalidate public data");
  await f.request("/api/copy",{method:"POST",body:{id:"fixture-entry"},auth:owner});
  const changed=await f.request(route,{auth:owner});assert.equal(changed.json.changed,true);assert.notEqual(changed.json.revision,first.json.revision);assert.equal(changed.json.entries[0].copyCount,6);
  const reset=await f.request(`/api/admin/users/${MEMBER}/reset-password`,{method:"POST",body:{},auth:owner});
  const member=await f.login(MEMBER,reset.json.temporaryPassword);
  const restricted=await f.request(route,{auth:member});assert.equal(restricted.json.user.mustChangePassword,true);assert.equal(restricted.json.entries,undefined);assert.equal(restricted.json.users,undefined);assert.equal(restricted.json.revision,null);
  f.app().sessions.revokeUser(OWNER);
  const revoked=await f.request(route,{auth:owner});assert.equal(revoked.json.user,null);assert.equal(revoked.json.entries,undefined);assert.equal(revoked.json.csrfToken,"");
});
test("static responses negotiate compression, reuse cached bytes, and revalidate without response bodies",async t=>{
  const f=await fixture(t);await f.start();
  const result=await f.request("/js/app.js",{headers:{"Accept-Encoding":"br,gzip"}});assert.equal(result.status,200);assert.equal(result.headers["content-encoding"],"br");assert.match(result.headers.vary,/Accept-Encoding/);assert.equal(result.headers["cache-control"],"no-cache");
  const reads=f.app().assets.stats.reads;
  const cached=await f.request("/js/app.js",{headers:{"Accept-Encoding":"br,gzip","If-None-Match":result.headers.etag}});assert.equal(cached.status,304);assert.equal(cached.text,"");assert.equal(f.app().assets.stats.reads,reads);
  const identity=await f.request("/js/app.js");assert.equal(identity.status,200);assert.equal(identity.headers["content-encoding"],undefined);assert.notEqual(identity.headers.etag,result.headers.etag);assert.ok(Number(identity.headers["content-length"])>Number(result.headers["content-length"]));assert.equal(f.app().assets.stats.reads,reads);
  const head=await f.request("/js/app.js",{method:"HEAD",headers:{"Accept-Encoding":"gzip"}});assert.equal(head.status,200);assert.equal(head.headers["content-encoding"],"gzip");assert.equal(head.text,"");
  assert.equal((await f.request("/js/app.js",{headers:{"Accept-Encoding":"*;q=0"}})).status,406);
});
