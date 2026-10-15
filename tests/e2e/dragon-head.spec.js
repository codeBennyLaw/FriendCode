"use strict";
const { test, expect } = require("@playwright/test");
const path = require("node:path");
test("dragon jaw, mane, whiskers and eyelids animate as separate vector parts", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.setContent('<body style="margin:0;background:#101626"><canvas width="1000" height="650" aria-label="动画龙头测试画布"></canvas></body>');
  await page.addScriptTag({ path: path.resolve(__dirname, "../../public/js/dragon-head.js") });
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("canvas"), ctx = canvas.getContext("2d");
    function render(time) { ctx.clearRect(0,0,1000,650); ctx.save(); ctx.translate(370,300); ctx.scale(5,5); GoldenDragonHead.draw(ctx,time); ctx.restore(); return ctx.getImageData(0,0,1000,650).data; }
    const first = render(0), second = render(.9), blink = render(5.5);
    function differs(a,b,region) {
      let count = 0;
      for(let y=region[1];y<region[3];y++) for(let x=region[0];x<region[2];x++) { const i=(y*1000+x)*4; if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])+Math.abs(a[i+3]-b[i+3])>10)count++; }
      return count;
    }
    const changes = { jaw: differs(first,second,[365,350,535,415]), mane: differs(first,second,[140,200,280,420]), whiskers: differs(first,second,[570,140,760,470]), eyelids: differs(first,blink,[380,250,445,285]) };
    // Preview several independent poses, without using any bitmap image.
    ctx.clearRect(0,0,1000,650);
    const times = [0,.9,1.8,5.5];
    for(let i=0;i<4;i++) { ctx.save(); ctx.translate(210+(i%2)*480,180+Math.floor(i/2)*310); ctx.scale(3.1,3.1); GoldenDragonHead.draw(ctx,times[i]); ctx.restore(); }
    return changes;
  });
  expect(result.jaw).toBeGreaterThan(100); expect(result.mane).toBeGreaterThan(100); expect(result.whiskers).toBeGreaterThan(100); expect(result.eyelids).toBeGreaterThan(50);
  await page.screenshot({ path: testInfo.outputPath("articulated-head-poses.png") });
});
