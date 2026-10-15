"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { AssetCache, accepts, matchesEtag } = require("../src/assets");
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"friendcode-asset-test-"));
  t.after(async()=>{const target=path.resolve(dir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith("friendcode-asset-test-"));await fs.rm(target,{recursive:true,force:true});});
  return dir;
}
test("asset cache deduplicates concurrent reads and creates lossless encoding variants once",async t=>{
  const dir=await fixture(t),file=path.join(dir,"app.js"),body=Buffer.from('const greeting = "hello";\n'.repeat(500));await fs.writeFile(file,body);
  const cache=new AssetCache();const entries=await Promise.all(Array.from({length:10},()=>cache.get(file,{type:"text/javascript"})));
  assert.equal(cache.stats.reads,1);assert.equal(cache.stats.builds,1);assert.ok(entries.every(entry=>entry===entries[0]));
  const entry=entries[0];assert.deepEqual(entry.variants.identity.body,body);assert.deepEqual(zlib.gunzipSync(entry.variants.gzip.body),body);assert.deepEqual(zlib.brotliDecompressSync(entry.variants.br.body),body);
  assert.equal((await cache.get(file,{type:"text/javascript"})),entry);assert.equal(cache.stats.reads,1);assert.equal(cache.stats.hits,1);
  assert.ok(entry.variants.br.body.length<body.length/2);
});
test("asset cache invalidates modified files, injects only the configured base path, and bounds memory",async t=>{
  const dir=await fixture(t),file=path.join(dir,"index.html"),cache=new AssetCache({maxEntries:2,maxBytes:10_000});
  await fs.writeFile(file,'<base href="__BASE_PATH__/">');
  const first=await cache.get(file,{type:"text/html",htmlBasePath:"/friends"});assert.equal(first.variants.identity.body.toString(),'<base href="/friends/">');
  await fs.writeFile(file,'<base href="__BASE_PATH__/"><h1>changed</h1>');
  const second=await cache.get(file,{type:"text/html",htmlBasePath:"/friends"});assert.notEqual(second.variants.identity.etag,first.variants.identity.etag);assert.equal(cache.stats.reads,2);
  for(let i=0;i<4;i++){const name=path.join(dir,`${i}.css`);await fs.writeFile(name,'.x { color: red; }');await cache.get(name,{type:"text/css"});}
  assert.ok(cache.entries.size<=2);assert.ok(cache.bytes<=cache.maxBytes);
  cache.clear();assert.equal(cache.bytes,0);assert.equal(cache.entries.size,0);
});
test("encoding negotiation honors explicit exclusions and conditional validators",async t=>{
  const dir=await fixture(t),file=path.join(dir,"style.css");await fs.writeFile(file,'.card {color:cyan;}\n'.repeat(100));
  const {variants}=await new AssetCache().get(file,{type:"text/css"});
  assert.equal(accepts("br, gzip",variants).encoding,"br");assert.equal(accepts("br;q=0,gzip;q=1",variants).encoding,"gzip");assert.equal(accepts("",variants).encoding,"identity");
  assert.equal(accepts("identity;q=0,*;q=0",variants),null);
  assert.equal(matchesEtag(`"other", W/${variants.br.etag}`,variants.br.etag),true);assert.equal(matchesEtag(variants.gzip.etag,variants.br.etag),false);assert.equal(matchesEtag("*",variants.br.etag),true);
});
