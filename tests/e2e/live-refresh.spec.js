"use strict";
const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createApplication } = require("../../src/app");
const { GAMES } = require("../../public/js/games");
const { listenLoopback } = require("../../scripts/test-server");
const OWNER = "10001", MEMBER = "10002";
let app, directory, origin;
function entry(id, qq, copyCount, extra = {}) { return { id, qq, nick: qq === OWNER ? "站长" : "群友", game: GAMES[0].name, server: GAMES[0].servers[0], code: `code-${id}`, note: "", copyCount, createdAt: 1, ...extra }; }
test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "friendcode-live-refresh-"));
  await fs.writeFile(path.join(directory, "user.json"), JSON.stringify({ users: {
    [OWNER]: { qq: OWNER, password: "owner-password", nick: "站长", role: "admin" },
    [MEMBER]: { qq: MEMBER, password: "member-password", nick: "群友", role: "user" },
  } }));
  await fs.writeFile(path.join(directory, "data.json"), JSON.stringify({ entries: [entry("owner", OWNER, 100), entry("a", MEMBER, 20), entry("b", MEMBER, 10)] }));
  app = await createApplication({ dataDir: directory, publicDir: path.resolve(__dirname, "../../public"), ownerQq: OWNER, basePath: "", registerCode: "test-invite", secureCookies: false, sessionTtl: 3600_000 });
  await listenLoopback(app.server); origin = `http://127.0.0.1:${app.server.address().port}/`;
});
test.afterEach(async () => {
  if (app) await app.close();
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("friendcode-live-refresh-")) throw new Error("Unsafe fixture cleanup");
  await fs.rm(resolved, { recursive: true, force: true });
});
async function settle(page) {
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.id.startsWith("fc-live-") && animation.playState === "running"));
  await page.waitForTimeout(50);
}
async function login(page) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("https://q.qlogo.cn/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#253550"/></svg>' }));
  await page.goto(origin); await page.locator("#loginBtn").click(); await page.locator("#loginQq").fill(OWNER); await page.locator("#loginPwd").fill("owner-password"); await page.locator("#loginSubmit").click();
  await expect(page.locator("#entryList .card")).toHaveCount(app.store.dataDoc.entries.length); await settle(page);
}
async function refresh(page) { await page.evaluate(() => autoRefresh()); }
async function remember(page) {
  await page.evaluate(() => {
    window.savedNodes = { cards: new Map([...document.querySelectorAll("#entryList .card")].map(card => [card.dataset.id, card])), canvas: document.querySelector("#entryList .dragon-border"), avatar: document.querySelector("#ownAvatar img"), stat: document.querySelector("#statsBar .num"), chip: document.querySelector("#gameTags .chip"), aAvatar: document.querySelector('[data-id="a"] .avatar'), aCopy: document.querySelector('[data-id="a"] .copy') };
  });
}
test("unchanged backend refreshes produce no DOM mutations, avatar reloads or dragon remounts", async ({ page }) => {
  let avatarRequests = 0; page.on("request", request => { if (request.url().startsWith("https://q.qlogo.cn")) avatarRequests++; });
  await login(page); await remember(page); const beforeRequests = avatarRequests;
  const syncResponses=[];page.on("response",response=>{if(new URL(response.url()).pathname==="/api/sync")syncResponses.push(response.json());});
  for (const id of ["owner", "a"]) {
    const layout = await page.locator(`#entryList .card[data-id="${id}"]`).evaluate(card => {
      const main = card.querySelector(".card-main").getBoundingClientRect(), tags = card.querySelector(".card-tags").getBoundingClientRect();
      return { display: getComputedStyle(card).display, delta: Math.abs((main.top + main.bottom) / 2 - (tags.top + tags.bottom) / 2) };
    });
    expect(layout.display).toBe("flex"); expect(layout.delta).toBeLessThan(2);
  }
  await page.evaluate(() => {
    window.savedDerived=getDerived();
    window.mutations = [];
    window.refreshObserver = new MutationObserver(records => mutations.push(...records));
    for (const id of ["entryList", "accountArea", "statsBar", "gameTags", "serverTags"]) refreshObserver.observe(document.getElementById(id), { childList: true, subtree: true, attributes: true, characterData: true });
  });
  for (let i=0;i<3;i++) await refresh(page);
  const result = await page.evaluate(() => {
    refreshObserver.disconnect();
    return { sameDerived: savedDerived===getDerived(), mutations: mutations.length, sameCards: [...savedNodes.cards].every(([id,node])=>document.querySelector(`#entryList .card[data-id="${id}"]`)===node), sameCanvas: savedNodes.canvas === document.querySelector("#entryList .dragon-border"), sameAvatar: savedNodes.avatar === document.querySelector("#ownAvatar img"), sameStat: savedNodes.stat === document.querySelector("#statsBar .num"), sameChip: savedNodes.chip === document.querySelector("#gameTags .chip"), active: document.querySelector("#entryList").getAnimations({ subtree: true }).filter(a=>a.id.startsWith("fc-live-")).length };
  });
  expect(result).toEqual({ sameDerived:true, mutations:0, sameCards:true, sameCanvas:true, sameAvatar:true, sameStat:true, sameChip:true, active:0 });
  expect(avatarRequests).toBe(beforeRequests);
  expect(syncResponses).toHaveLength(3);for(const response of await Promise.all(syncResponses)){expect(response.changed).toBe(false);expect(response.entries).toBeUndefined();expect(response.users).toBeUndefined();}
});
test("new records enter, changed fields transition, sorting moves retained nodes, deletions fade out", async ({ page }) => {
  await login(page); await remember(page);
  await app.store.mutate("data", doc => doc.entries.push(entry("new", MEMBER, 15, { createdAt: 2 })));
  await refresh(page);
  expect(await page.locator('#entryList .card[data-id="new"]').evaluate(node => node.getAnimations().some(animation => animation.id === "fc-live-enter"))).toBe(true);
  expect(await page.evaluate(() => savedNodes.canvas === document.querySelector("#entryList .dragon-border"))).toBe(true);
  await settle(page);
  expect(await page.locator("#entryList > .card").evaluateAll(cards=>cards.map(card=>card.dataset.id))).toEqual(["owner","a","new","b"]);
  await page.locator('#entryList .card[data-id="a"] .edit').evaluate(button=>{button.focus();window.savedFocusedButton=button;});
  await app.store.mutate("users", doc => { doc.users[OWNER].nick = "站长新昵称"; doc.users[MEMBER].nick = "群友新昵称"; });
  await app.store.mutate("data", doc => { Object.assign(doc.entries.find(item=>item.id==="a"), { code:"updated-code", note:'<img src=x onerror="alert(1)">', game:GAMES[1].name, server:GAMES[1].servers[0], copyCount:200 }); });
  await refresh(page);
  const animated = await page.locator('#entryList .card[data-id="a"]').evaluate(node=>({ move:node.getAnimations().some(a=>a.id==="fc-live-move"), field:node.querySelector(".code-val").getAnimations().some(a=>a.id==="fc-live-field") }));
  expect(animated).toEqual({move:true,field:true});
  expect(await page.evaluate(()=>document.activeElement===savedFocusedButton)).toBe(true);
  expect(await page.evaluate(()=>savedNodes.cards.get("a")===document.querySelector('#entryList .card[data-id="a"]') && savedNodes.aAvatar===document.querySelector('#entryList .card[data-id="a"] .avatar') && savedNodes.aCopy===document.querySelector('#entryList .card[data-id="a"] .copy') && savedNodes.avatar===document.querySelector("#ownAvatar img"))).toBe(true);
  await expect(page.locator('#entryList .card[data-id="a"] .nick')).toHaveText("群友新昵称");
  await expect(page.locator('#entryList .card[data-id="a"] .note')).toHaveText('<img src=x onerror="alert(1)">');
  await expect(page.locator('#entryList .card[data-id="a"] .note img')).toHaveCount(0);
  await settle(page);
  expect(await page.locator("#entryList > .card").evaluateAll(cards=>cards.map(card=>card.dataset.id))).toEqual(["a","owner","new","b"]);
  await page.locator('#entryList .card[data-id="a"] .edit').click(); await expect(page.locator("#codeInput")).toHaveValue("updated-code"); await page.locator("#addCancel").click();
  await app.store.mutate("data",doc=>{doc.entries.find(item=>item.id==="a").note="";}); await refresh(page);
  await expect(page.locator('#entryList .card[data-id="a"] .live-field-ghost')).toHaveCount(1);
  await settle(page); await expect(page.locator('#entryList .card[data-id="a"] .note')).toHaveCount(0);
  await app.store.mutate("data", doc=>{doc.entries=doc.entries.filter(item=>item.id!=="b");});
  await refresh(page);
  await expect(page.locator('#entryList .card[data-id="b"]')).toHaveClass(/live-leaving/);
  await expect(page.locator('#entryList .card[data-id="b"]')).toHaveAttribute("aria-hidden","true");
  await settle(page); await expect(page.locator('#entryList .card[data-id="b"]')).toHaveCount(0);
  expect(await page.evaluate(()=>savedNodes.canvas===document.querySelector("#entryList .dragon-border"))).toBe(true);
});
test("open profile updates in place without resetting nickname drafts, focus or selection", async ({ page }) => {
  await login(page); await page.locator("#ownQq").click(); await settle(page);
  await page.locator("#nickEdit").fill("未保存的草稿");
  await page.locator("#nickEdit").evaluate(node=>{node.setSelectionRange(2,4);window.savedEditor=node;window.savedProfileCanvas=document.querySelector("#profileBody .dragon-border");});
  await app.store.mutate("users", doc=>{doc.users[OWNER].nick="另一设备修改";});
  await app.store.mutate("data", doc=>doc.entries.push(entry("new-owner",OWNER,40,{createdAt:3})));
  await refresh(page); await settle(page);
  await expect(page.locator("#nickEdit")).toHaveValue("未保存的草稿");
  expect(await page.evaluate(()=>({same:savedEditor===document.querySelector("#nickEdit"),focus:document.activeElement===savedEditor,start:savedEditor.selectionStart,end:savedEditor.selectionEnd,canvas:savedProfileCanvas===document.querySelector("#profileBody .dragon-border")}))).toEqual({same:true,focus:true,start:2,end:4,canvas:true});
  await expect(page.locator("#profileBody .profile-entry-count")).toHaveText("2");
  await expect(page.locator("#profileBody .card .card-main, #profileBody .card .avatar, #profileBody .card .qq, #profileBody .card .nick")).toHaveCount(0);
  await page.locator("#nickSave").click(); await expect(page.locator("#accountArea .nick")).toHaveText("未保存的草稿");
  await expect(page.locator("#nickEdit")).toHaveValue("未保存的草稿");
});
test("inserting above the viewport preserves the currently visible card position", async ({ page }) => {
  await app.store.mutate("data", doc=>{for(let i=0;i<25;i++)doc.entries.push(entry(`row-${i}`,MEMBER,8,{createdAt:100-i}));});
  await login(page); await page.locator('#entryList .card[data-id="row-10"]').scrollIntoViewIfNeeded();
  const anchor = await page.evaluate(()=>{
    const card=[...document.querySelectorAll("#entryList .card")].find(node=>{const r=node.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;});
    return {id:card.dataset.id,top:card.getBoundingClientRect().top,scroll:scrollY};
  });
  await app.store.mutate("data", doc=>doc.entries.push(entry("top-new",MEMBER,999,{createdAt:999})));
  await refresh(page); await settle(page);
  const after=await page.evaluate(id=>({top:document.querySelector(`#entryList .card[data-id="${id}"]`).getBoundingClientRect().top,scroll:scrollY}),anchor.id);
  expect(Math.abs(after.top-anchor.top)).toBeLessThan(3); expect(after.scroll).toBeGreaterThan(anchor.scroll);
});
test("rapid add/remove/add cancels old transitions without duplicating cards; reduced motion stays usable", async ({ page }) => {
  await login(page);
  await app.store.mutate("data", doc=>doc.entries.push(entry("rapid",MEMBER,30))); await refresh(page);
  await page.evaluate(()=>{window.rapidCard=document.querySelector('#entryList .card[data-id="rapid"]');});
  await app.store.mutate("data", doc=>{doc.entries=doc.entries.filter(item=>item.id!=="rapid");}); await refresh(page);
  await app.store.mutate("data", doc=>doc.entries.push(entry("rapid",MEMBER,30))); await refresh(page);
  await settle(page); await expect(page.locator('#entryList .card[data-id="rapid"]')).toHaveCount(1);
  expect(await page.evaluate(()=>rapidCard===document.querySelector('#entryList .card[data-id="rapid"]'))).toBe(true);
  await page.emulateMedia({reducedMotion:"reduce"});
  await app.store.mutate("data", doc=>doc.entries.push(entry("reduced",MEMBER,31))); await refresh(page);
  await expect(page.locator('#entryList .card[data-id="reduced"]')).toHaveCount(1);
  expect(await page.evaluate(()=>document.querySelector("#entryList").getAnimations({subtree:true}).filter(a=>a.id.startsWith("fc-live-")).length)).toBe(0);
});

test("active search filters remain selected while matching backend records animate in", async ({ page }) => {
  await login(page); await page.locator("#searchInput").click(); await page.locator("#searchInput").fill("code-a"); await settle(page);
  await expect(page.locator("#entryList > .card")).toHaveCount(1);
  await page.evaluate(()=>{window.filteredNode=document.querySelector('#entryList .card[data-id="a"]');window.savedSearch=document.querySelector("#searchInput");});
  await app.store.mutate("data", doc=>{doc.entries.push(entry("matching",MEMBER,15,{code:"code-another"}));doc.entries.push(entry("not-matching",MEMBER,16));});
  await refresh(page); await settle(page);
  await expect(page.locator("#searchInput")).toHaveValue("code-a");
  await expect(page.locator("#entryList > .card")).toHaveCount(2);
  expect(await page.evaluate(()=>filteredNode===document.querySelector('#entryList .card[data-id="a"]')&&savedSearch===document.querySelector("#searchInput"))).toBe(true);
});
test("profile scrolling is anchored when new records arrive above the visible profile cards", async ({ page }) => {
  await app.store.mutate("data", doc=>{for(let i=0;i<12;i++)doc.entries.push(entry(`owner-row-${i}`,OWNER,8,{createdAt:100-i}));});
  await login(page); await page.locator("#ownQq").click(); await settle(page);
  const before=await page.locator(".profile-box").evaluate(panel=>{
    panel.scrollTop=600;const viewport=panel.getBoundingClientRect();
    const node=[...panel.querySelectorAll(".profile-grid .card")].find(card=>{const r=card.getBoundingClientRect();return r.bottom>viewport.top&&r.top<viewport.bottom;});
    return {id:node.dataset.id,top:node.getBoundingClientRect().top,scroll:panel.scrollTop};
  });
  await app.store.mutate("data", doc=>doc.entries.push(entry("profile-new-first",OWNER,999,{createdAt:999})));
  await refresh(page); await settle(page);
  const after=await page.locator(".profile-box").evaluate((panel,id)=>({top:panel.querySelector(`.card[data-id="${id}"]`).getBoundingClientRect().top,scroll:panel.scrollTop}),before.id);
  expect(Math.abs(after.top-before.top)).toBeLessThan(3);expect(after.scroll).toBeGreaterThan(before.scroll);
});

test("copy count updates immediately but the hovered card waits for mouse exit before ranking moves", async ({ page }) => {
  await app.store.mutate("data", doc=>{doc.entries.find(item=>item.id==="b").copyCount=20;});
  await login(page); await page.evaluate(()=>{FC.copy=async()=>{};window.hoveredOriginal=document.querySelector('#entryList .card[data-id="b"]');});
  const order=()=>page.locator("#entryList > .card:not(.live-leaving)").evaluateAll(cards=>cards.map(card=>card.dataset.id));
  expect(await order()).toEqual(["owner","a","b"]);
  await page.locator('#entryList .card[data-id="b"] .copy').click();
  await expect(page.locator('#entryList .card[data-id="b"] .copy-count b')).toHaveText("21");
  expect(app.store.dataDoc.entries.find(item=>item.id==="b").copyCount).toBe(21);
  expect(await order()).toEqual(["owner","a","b"]);
  const box=await page.locator('#entryList .card[data-id="b"]').boundingBox();
  await page.mouse.move(box.x+12,box.y+12); await page.waitForTimeout(100);
  expect(await order()).toEqual(["owner","a","b"]);
  await page.mouse.move(5,5);
  await expect.poll(order).toEqual(["owner","b","a"]); await settle(page);
  expect(await page.evaluate(()=>hoveredOriginal===document.querySelector('#entryList .card[data-id="b"]'))).toBe(true);
});
test("profile cards also defer ranking until leaving the card, including moving directly to a neighbor", async ({ page }) => {
  await app.store.mutate("data", doc=>{for(const item of doc.entries)if(item.id!=="owner"){item.qq=OWNER;item.copyCount=20;}});
  await login(page); await page.locator("#ownQq").click(); await settle(page); await page.evaluate(()=>{FC.copy=async()=>{};});
  const profileOrder=()=>page.locator("#profileBody .profile-grid > .card:not(.live-leaving)").evaluateAll(cards=>cards.map(card=>card.dataset.id));
  await page.locator('#profileBody .card[data-id="b"] .copy').click();
  await expect(page.locator('#profileBody .card[data-id="b"] .copy-count b')).toHaveText("21");
  expect(await profileOrder()).toEqual(["owner","a","b"]);
  expect(await page.locator("#entryList > .card:not(.live-leaving)").evaluateAll(cards=>cards.map(card=>card.dataset.id))).toEqual(["owner","b","a"]);
  await page.locator('#profileBody .card[data-id="a"] .copy').hover();
  await expect.poll(profileOrder).toEqual(["owner","b","a"]); await settle(page);
});

test("covered background dragons pause while the active profile stays animated, including nested dialogs",async({page})=>{
  await login(page);
  await page.evaluate(()=>{
    window.paintCounts={background:0,dialog:0};
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.classList.contains("dragon-border"))paintCounts[this.canvas.closest(".modal")?"dialog":"background"]++;return clear.apply(this,args);};
  });
  await page.waitForFunction(()=>paintCounts.background>0);
  await page.locator("#ownQq").click();await settle(page);await page.waitForTimeout(150);
  await page.evaluate(()=>{paintCounts.background=0;paintCounts.dialog=0;});await page.waitForTimeout(240);
  expect(await page.evaluate(()=>paintCounts.background)).toBe(0);expect(await page.evaluate(()=>paintCounts.dialog)).toBeGreaterThan(0);
  expect(await page.locator(".bg-bars span").first().evaluate(element=>getComputedStyle(element).animationPlayState)).toBe("paused");
  await page.locator('#profileBody .card[data-id="owner"] .del').click();await expect(page.locator("#delModal")).toBeVisible();await page.waitForTimeout(280);
  const top=await page.locator("#delPwd").evaluate(input=>{const rect=input.getBoundingClientRect();return document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2).closest(".modal").id;});expect(top).toBe("delModal");
  await page.evaluate(()=>{paintCounts.background=0;paintCounts.dialog=0;});await page.waitForTimeout(200);expect(await page.evaluate(()=>paintCounts)).toEqual({background:0,dialog:0});
  await page.locator("#delCancel").click();await expect(page.locator("#delModal")).toBeHidden();await page.waitForFunction(()=>paintCounts.dialog>0);
  await page.locator("#profileClose").click();await expect(page.locator("#profileModal")).toBeHidden();
  await page.evaluate(()=>{paintCounts.background=0;paintCounts.dialog=0;});await page.waitForTimeout(200);expect(await page.evaluate(()=>paintCounts.background)).toBeGreaterThan(0);expect(await page.evaluate(()=>paintCounts.dialog)).toBe(0);
  expect(await page.locator(".bg-bars span").first().evaluate(element=>getComputedStyle(element).animationPlayState)).toBe("running");
});
test("an old in-flight sync cannot overwrite the new password-change session or CSRF token",async({page})=>{
  await login(page);
  let release,ready;const blocked=new Promise(resolve=>{ready=resolve;});let hold=true;
  await page.route("**/api/sync*",async route=>{
    if(!hold){await route.continue();return;}hold=false;
    const response=await route.fetch();ready();await new Promise(resolve=>{release=resolve;});await route.fulfill({response});
  });
  await page.evaluate(()=>{window.heldRefresh=autoRefresh();});await blocked;
  await page.locator("#changePwdBtn").click();await page.locator("#pwdOld").fill("owner-password");await page.locator("#pwdNew").fill("new-owner-password");await page.locator("#pwdNew2").fill("new-owner-password");await page.locator("#pwdSubmit").click();
  await expect(page.locator("#pwdModal")).toBeHidden();release();await page.evaluate(()=>heldRefresh);
  await page.locator("#addBtn").click();await page.locator("#codeInput").fill("after-password-change");await page.locator("#addSubmit").click();
  await expect(page.locator("#entryList .code-val",{hasText:"after-password-change"})).toHaveCount(1);
});
test("revoked sync sessions clear open private dialogs and do not retain group cards",async({page})=>{
  await login(page);await page.locator('#entryList .card[data-id="a"] .edit').click();await expect(page.locator("#addModal")).toBeVisible();
  app.sessions.revokeUser(OWNER);await refresh(page);
  await expect(page.locator("#addModal")).toBeHidden();await expect(page.locator("#entryList .card")).toHaveCount(0);await expect(page.locator("#loginBtn")).toBeVisible();
});

test("search work is coalesced per frame and waits for a completed Chinese IME composition",async({page})=>{
  await login(page);await page.locator("#searchInput").click();
  await page.evaluate(()=>{
    const original=renderList;window.searchRenders=0;window.renderList=(...args)=>{searchRenders++;return original(...args);};
    const input=document.querySelector("#searchInput");input.value="code-a";input.dispatchEvent(new InputEvent("input",{bubbles:true,isComposing:true}));
  });
  await page.waitForTimeout(70);expect(await page.evaluate(()=>searchRenders)).toBe(0);await expect(page.locator("#entryList > .card")).toHaveCount(3);
  expect(await page.evaluate(()=>filters.search)).toBe("");
  await app.store.mutate("data",doc=>doc.entries.push(entry("composition-new",MEMBER,0)));await refresh(page);await settle(page);await expect(page.locator("#entryList > .card")).toHaveCount(4);
  await page.evaluate(()=>{searchRenders=0;});
  await page.locator("#searchInput").evaluate(input=>{input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));for(let i=0;i<15;i++)input.dispatchEvent(new InputEvent("input",{bubbles:true}));});
  await settle(page);await expect(page.locator("#entryList > .card")).toHaveCount(1);expect(await page.evaluate(()=>searchRenders)).toBe(1);
});
test("a freshly reloaded client can still use the old sync protocol until Node restarts",async({page})=>{
  await page.route("**/api/sync*",route=>route.fulfill({status:404,contentType:"application/json",body:JSON.stringify({ok:false,error:"old server"})}));
  await login(page);await expect(page.locator("#entryList .card")).toHaveCount(3);
  await page.unroute("**/api/sync*");await refresh(page);await expect(page.locator("#ownQq")).toHaveText(OWNER+" 站长");
});
