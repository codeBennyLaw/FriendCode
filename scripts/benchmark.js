"use strict";
// Repeatable, fictitious-data-only performance smoke test. No deployment configuration is read.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("@playwright/test");
const { createApplication } = require("../src/app");
const { GAMES } = require("../public/js/games");
const { listenLoopback } = require("./test-server");
async function main() {
  const root = path.resolve(__dirname, ".."), dir = await fs.mkdtemp(path.join(os.tmpdir(), "friendcode-perf-"));
  let app, browser;
  try {
    await fs.writeFile(path.join(dir, "user.json"), JSON.stringify({ users: { "10001": { qq: "10001", password: "test-password", nick: "测试", role: "admin" }, "10002": { qq: "10002", password: "member-password", nick: "群友", role: "user" } } }));
    await fs.writeFile(path.join(dir, "data.json"), JSON.stringify({ entries: Array.from({ length: 60 }, (_, index) => ({ id: `perf-${index}`, qq: index ? "10002" : "10001", nick: "测试", game: GAMES[0].name, server: GAMES[0].servers[0], code: `fixture-code-${index}`, note: "虚构的性能测试数据", copyCount: 60-index, createdAt: index })) }));
    app = await createApplication({ dataDir: dir, publicDir: path.join(root,"public"), ownerQq:"10001", basePath:"", registerCode:"test-invite", secureCookies:false, sessionTtl:3600_000 });
    await listenLoopback(app.server);
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel:process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport:{width:1280,height:900} });
    await page.route("https://q.qlogo.cn/**", route=>route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"/>'}));
    await page.goto(`http://127.0.0.1:${app.server.address().port}/`);
    await page.locator("#loginBtn").click(); await page.locator("#loginQq").fill("10001"); await page.locator("#loginPwd").fill("test-password"); await page.locator("#loginSubmit").click();
    await page.waitForFunction(()=>document.querySelectorAll("#entryList .card").length===60);
    const network = await page.evaluate(async()=>{
      const original=fetch, samples=[];
      window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes("api/"))samples.push({route:String(args[0]).split("?")[0],bytes:(await response.clone().arrayBuffer()).byteLength});return response;};
      for(let i=0;i<4;i++)await autoRefresh();
      window.fetch=original;return {polls:4,requests:samples.length,responseBytes:samples.reduce((sum,item)=>sum+item.bytes,0),routes:[...new Set(samples.map(item=>item.route))]};
    });
    const legacy=await page.evaluate(async()=>{
      let bytes=0;
      for(let i=0;i<4;i++)for(const route of ["session","data"]){const response=await fetch("api/"+route);bytes+=(await response.arrayBuffer()).byteLength;}
      return {polls:4,requests:8,responseBytes:bytes};
    });
    await page.emulateMedia({reducedMotion:"reduce"});
    const beforeReads = app.assets?.stats.reads;
    const assetUrl = `http://127.0.0.1:${app.server.address().port}/js/app.js`;
    const identity = await fetch(assetUrl,{headers:{"Accept-Encoding":"identity"}}), compressed = await fetch(assetUrl,{headers:{"Accept-Encoding":"br"}});
    await identity.arrayBuffer();await compressed.arrayBuffer();
    const asset = { identityBytes:Number(identity.headers.get("content-length")), brotliBytes:Number(compressed.headers.get("content-length")), extraFileReads:(app.assets?.stats.reads||0)-(beforeReads||0) };
    const render=await browser.newPage({viewport:{width:1280,height:900}});
    await render.setContent('<style>.card{position:relative;width:960px;height:180px;border-radius:16px;margin:70px}.dragon-border{position:absolute;inset:-64px;width:calc(100% + 128px);height:calc(100% + 128px)}</style><div class="card"><canvas class="dragon-border"></canvas></div>');
    await render.evaluate(()=>{window._perfFrames=new Map();let id=0;window.requestAnimationFrame=callback=>{_perfFrames.set(++id,callback);return id;};window.cancelAnimationFrame=key=>_perfFrames.delete(key);});
    await render.addScriptTag({path:path.join(root,"public/js/dragon-head.js")});await render.addScriptTag({path:path.join(root,"public/js/dragon-border.js")});
    await render.evaluate(()=>GoldenDragonBorder.mount(document)); await render.waitForFunction(()=>document.querySelector("canvas").width>500,null,{polling:50});await render.waitForTimeout(50);
    const drawing=await render.evaluate(()=>{
      let time=1000;
      const batch=count=>{const start=performance.now();for(let i=0;i<count;i++){const tasks=[..._perfFrames.values()];_perfFrames.clear();time+=40;for(const task of tasks)task(time);}return (performance.now()-start)/count;};
      batch(12);const samples=Array.from({length:7},()=>batch(16)).sort((a,b)=>a-b);
      const canvas=document.querySelector("canvas"),ctx=canvas.getContext("2d");
      return {dragonWidth:960,dragonHeight:180,medianDrawMs:Number(samples[3].toFixed(3)),frameRateCap:30,image:canvas.toDataURL(),canvasHasArtwork:ctx.getImageData(0,0,canvas.width,canvas.height).data.some(value=>value!==0)};
    });
    drawing.pixelChecksum=require("node:crypto").createHash("sha256").update(drawing.image).digest("hex");delete drawing.image;
    console.log(JSON.stringify({legacyNetwork:legacy,network,asset,drawing},null,2));
  } finally {
    if(browser)await browser.close();if(app)await app.close();
    const resolved=path.resolve(dir);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith("friendcode-perf-"))throw new Error("Unsafe cleanup");
    await fs.rm(resolved,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
