"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createApplication } = require("../../src/app");
const { GAMES } = require("../../public/js/games");
const { listenLoopback } = require("../../scripts/test-server");
let app, directory, origin;
const OWNER = "1000000001";
const profileGame = GAMES.find(game => game.name === "Project SEKAI") || GAMES[0];
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "friendcode-dragon-layout-"));
  await fs.writeFile(path.join(directory, "user.json"), JSON.stringify({ users: { [OWNER]: { qq: OWNER, nick: "测试站长", role: "admin", password: "owner-password" } } }));
  await fs.writeFile(path.join(directory, "data.json"), JSON.stringify({ entries: [
    { id: "owner-long-code", qq: OWNER, nick: "测试站长", game: profileGame.name, server: profileGame.servers[0], code: "1234567890123456789", note: "测试备注", copyCount: 9_000_000_000_000, createdAt: 1 },
    { id: "owner-max-code", qq: OWNER, nick: "测试站长", game: GAMES[0].name, server: GAMES[0].servers[0], code: "X".repeat(120), note: "测试长备注。".repeat(40), copyCount: 0, createdAt: 2 },
  ] }));
  app = await createApplication({ dataDir: directory, publicDir: path.resolve(__dirname, "../../public"), ownerQq: OWNER, basePath: "", registerCode: "test-invite-code", sessionTtl: 3600_000, secureCookies: false });
  await listenLoopback(app.server);
  origin = `http://127.0.0.1:${app.server.address().port}/`;
});
test.afterAll(async () => {
  if (app) await app.close();
  if (directory) {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("friendcode-dragon-layout-")) throw new Error("Unsafe test cleanup");
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
async function assertCardLayout(page, selector) {
  const cards = page.locator(`${selector} .card-owner`); await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    const metrics = await card.evaluate(element => {
      const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      const controls = [...element.querySelectorAll(".copy, .edit, .del")];
      const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const box = rect(element);
      return {
        deleteInFlow: getComputedStyle(element.querySelector(".del")).position === "static",
        deleteInFooter: !!element.querySelector(".card-foot .card-actions .del"),
        controlsOverlap: controls.some((a, i) => controls.slice(i + 1).some(b => overlap(rect(a), rect(b)))),
        controlsOutsideCard: controls.some(node => { const r = rect(node); return r.left < box.left || r.right > box.right || r.top < box.top || r.bottom > box.bottom; }),
        contentOverflow: [...element.querySelectorAll(":scope > .card-main, :scope > .card-tags, :scope > .card-code, :scope > .card-foot")].some(node => { const r = rect(node); return node.scrollWidth > node.clientWidth + 1 || r.left < box.left || r.right > box.right; }),
        dragonBelowContent: Number(getComputedStyle(element.querySelector(".dragon-border")).zIndex) < Number(getComputedStyle(element.querySelector(".card-code")).zIndex),
      };
    });
    if (metrics.contentOverflow) console.log("Overflow diagnostics", selector, await card.evaluate(el => ({ viewport: innerWidth, card: el.getBoundingClientRect().width, children: [...el.children].filter(n => !n.classList.contains("dragon-border")).map(n => ({ class: n.className, client: n.clientWidth, scroll: n.scrollWidth, width: n.getBoundingClientRect().width })) })));
    expect(metrics).toEqual({ deleteInFlow: true, deleteInFooter: true, controlsOverlap: false, controlsOutsideCard: false, contentOverflow: false, dragonBelowContent: true });
  }
}
test("owner dragon cards keep controls separate on desktop, mobile and profile views", async ({ page }, testInfo) => {
  await page.route("https://q.qlogo.cn/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46"><rect width="46" height="46" fill="#253550"/></svg>' }));
  const bitmapRequests = [];
  page.on("request", request => { if (/dragon.*\.(png|mp4)(?:\?|$)/.test(request.url())) bitmapRequests.push(request.url()); });
  const headResponse = page.waitForResponse(response => response.url().endsWith("/js/dragon-head.js"));
  await page.goto(origin);
  const head = await headResponse; expect(head.status()).toBe(200); expect(head.headers()["content-type"]).toContain("javascript");
  expect(await page.evaluate(() => typeof window.GoldenDragonHead?.draw)).toBe("function");
  await page.locator("#loginBtn").click(); await page.locator("#loginQq").fill(OWNER); await page.locator("#loginPwd").fill("owner-password"); await page.locator("#loginSubmit").click();
  await expect(page.locator("#entryList .card-owner")).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family.replaceAll('"', "") === "Orbitron" && font.status === "loaded"))).toBe(true);
  expect(await page.locator("#entryList .code-val").first().evaluate(el => getComputedStyle(el).fontFamily)).toContain("Orbitron");
  for (const width of [1360, 885, 768, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await assertCardLayout(page, "#entryList");
    if (width >= 640) for (const card of await page.locator("#entryList .card-owner").all()) {
      const alignment = await card.evaluate(node => {
        const main = node.querySelector(".card-main").getBoundingClientRect(), tags = node.querySelector(".card-tags").getBoundingClientRect();
        return Math.abs((main.top + main.bottom) / 2 - (tags.top + tags.bottom) / 2);
      });
      expect(alignment, `home tags must share the identity row at ${width}px`).toBeLessThan(2);
    }
    if (width === 1360 || width === 390) await page.locator("#entryList").screenshot({ path: testInfo.outputPath(`dragon-cards-${width}.png`) });
    await page.locator("#ownQq").click(); await expect(page.locator("#profileModal")).toBeVisible();
    await assertCardLayout(page, "#profileBody");
    await expect(page.locator("#profileBody .card .card-main, #profileBody .card .avatar, #profileBody .card .qq, #profileBody .card .nick")).toHaveCount(0);
    await expect(page.locator("#profileBody .profile-head .avatar-lg")).toHaveCount(1);
    await expect(page.locator("#profileBody .profile-id")).toHaveText(OWNER);
    const panel = page.locator(".profile-box");
    const panelSize = await panel.evaluate(element => {
      element.scrollLeft = 100;
      return { width: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft };
    });
    expect(panelSize.scrollWidth, `profile width at ${width}px`).toBeLessThanOrEqual(panelSize.width + 1);
    expect(panelSize.scrollLeft).toBe(0);
    const compactCard = page.locator('#profileBody .card[data-id="owner-long-code"]');
    const height = await compactCard.evaluate(element => element.getBoundingClientRect().height);
    expect(height, `normal owner-card height at ${width}px`).toBeLessThan(width >= 885 ? 240 : width >= 640 ? 300 : 420);
    expect(await page.locator("#profileBody .copy").first().evaluate(element => parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThanOrEqual(16);
    if (width === 885 || width === 390) await panel.screenshot({ path: testInfo.outputPath(`profile-compact-${width}.png`) });
    await page.locator("#profileClose").click(); await expect(page.locator("#profileModal")).toBeHidden();
  }
  await page.locator("#entryList .del").first().click(); await expect(page.locator("#delModal")).toBeVisible();
  await page.locator("#delCancel").click(); await expect(page.locator("#delModal")).toBeHidden();
  expect(bitmapRequests).toEqual([]);
});
