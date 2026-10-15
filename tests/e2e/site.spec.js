"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createApplication } = require("../../src/app");
const { GAMES } = require("../../public/js/games");
const { listenLoopback } = require("../../scripts/test-server");
let app, dir, base;
const OWNER = "10001", MEMBER = "10002";
test.beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "friendcode-browser-"));
  await fs.writeFile(path.join(dir, "user.json"), JSON.stringify({ users: {
    [OWNER]: { qq: OWNER, password: "owner-password", nick: "测试站长", role: "admin" },
    [MEMBER]: { qq: MEMBER, password: "member-password", nick: "测试群友", role: "user" },
  } }));
  await fs.writeFile(path.join(dir, "data.json"), JSON.stringify({ entries: [] }));
  app = await createApplication({ root: path.resolve(__dirname, "../.."), publicDir: path.resolve(__dirname, "../../public"), dataDir: dir, ownerQq: OWNER, basePath: "", registerCode: "browser-invite", secureCookies: false, sessionTtl: 60 * 60_000 });
  await listenLoopback(app.server); base = `http://127.0.0.1:${app.server.address().port}/`;
});
test.afterAll(async () => {
  if (app) await app.close();
  if (dir) {
    const target = path.resolve(dir); if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(target).startsWith("friendcode-browser-")) throw new Error("Unsafe temporary cleanup");
    await fs.rm(target, { recursive: true, force: true });
  }
});
async function login(page, qq, password) {
  await page.locator("#loginBtn").click(); await page.locator("#loginQq").fill(qq); await page.locator("#loginPwd").fill(password); await page.locator("#loginSubmit").click();
}
test("member CRUD, owner recovery, invitation periods, and responsive layouts", async ({ browser }, testInfo) => {
  const memberContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const ownerContext = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const member = await memberContext.newPage(), owner = await ownerContext.newPage();
  const errors = []; for (const page of [member, owner]) page.on("pageerror", error => errors.push(error.message));
  // Avoid making requests to real third-party avatar servers while testing fictitious users.
  for (const context of [memberContext, ownerContext]) await context.route("https://q.qlogo.cn/**", route => route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#253550"/></svg>' }));
  try {
    await member.goto(base); await expect(member.locator("#emptyHint")).toContainText("请先登录");
    await login(member, MEMBER, "member-password"); await expect(member.locator("#ownQq")).toContainText(MEMBER);
    await expect(member.getByRole("link", { name: "管理后台" })).toHaveCount(0);
    await member.locator("#addBtn").click(); await member.locator("#codeInput").fill("browser-code"); await member.locator("#noteInput").fill('<img src=x onerror="alert(1)">');
    await member.locator("#addSubmit").click(); await expect(member.locator("#entryList .card")).toHaveCount(1);
    await expect(member.locator("#entryList .note")).toHaveText('<img src=x onerror="alert(1)">'); await expect(member.locator("#entryList .note img")).toHaveCount(0);
    await member.locator("#entryList .edit").click(); await member.locator("#codeInput").fill("updated-code"); await member.locator("#addSubmit").click(); await expect(member.locator("#entryList .code-val")).toHaveText("updated-code");
    await member.locator("#ownQq").click();
    await expect(member.locator("#profileBody .card .card-main")).toHaveCount(0);
    await expect(member.locator("#profileBody .profile-head .avatar-lg")).toHaveCount(1);
    await member.locator("#nickEdit").fill("新的测试昵称"); await member.locator("#nickSave").click(); await expect(member.locator("#accountArea .nick")).toHaveText("新的测试昵称"); await member.locator("#profileClose").click();
    await owner.goto(base); await login(owner, OWNER, "owner-password"); await owner.getByRole("link", { name: "管理后台" }).click();
    await expect(owner.locator("#adminContent")).toBeVisible(); await expect(owner.locator("#currentInviteCode")).toHaveText("browser-invite");
    await owner.locator("#openInviteDialog").click(); await owner.locator("#newInviteCode").fill("browser-new-invite"); await owner.locator("#inviteConfirm").click(); await expect(owner.locator("#currentInviteCode")).toHaveText("browser-new-invite");
    await owner.locator(".invite-history summary").click(); await expect(owner.locator(".invite-history-row")).toHaveCount(2); await expect(owner.locator("#inviteHistory")).toContainText("至今");
    await owner.screenshot({ path: testInfo.outputPath("admin-desktop.png"), fullPage: true });
    const row = owner.locator(".member-row").filter({ hasText: `QQ ${MEMBER}` }); await row.getByRole("button", { name: "重置账号" }).click();
    await owner.locator("#resetConfirm").click(); await expect(owner.locator("#resetResult")).toBeVisible(); const temporary = await owner.locator("#temporaryPassword").inputValue(); expect(temporary).toHaveLength(18);
    await owner.locator("#resetDone").click(); await expect(owner.locator("#temporaryPassword")).toHaveValue("");
    await member.reload(); await expect(member.locator("#loginBtn")).toBeVisible(); await login(member, MEMBER, temporary);
    await expect(member.locator("#pwdModal")).toBeVisible(); await expect(member.locator("#pwdCancel")).toBeHidden(); await expect(member.locator("#entryList .card")).toHaveCount(0);
    await member.locator("#pwdOld").fill(temporary); await member.locator("#pwdNew").fill("changed-member-password"); await member.locator("#pwdNew2").fill("changed-member-password"); await member.locator("#pwdSubmit").click();
    await expect(member.locator("#pwdModal")).toBeHidden(); await expect(member.locator("#entryList .code-val")).toHaveText("updated-code");
    expect(await member.evaluate(() => ["fc_u", "fc_e", "fc_s"].some(key => localStorage.getItem(key) !== null))).toBe(false);
    for (const page of [member, owner]) { await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    await owner.screenshot({ path: testInfo.outputPath("admin-mobile.png"), fullPage: true }); await member.screenshot({ path: testInfo.outputPath("member-mobile.png"), fullPage: true });
    await member.locator("#entryList .del").click(); await member.locator("#delPwd").fill("changed-member-password"); await member.locator("#delSubmit").click(); await expect(member.locator("#entryList .card")).toHaveCount(0);
    const forbidden = await memberContext.request.get(`${base}api/admin/invite-codes`); expect(forbidden.status()).toBe(403);
    expect(errors).toEqual([]);
  } finally { await memberContext.close(); await ownerContext.close(); }
});
