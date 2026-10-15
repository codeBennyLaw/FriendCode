"use strict";
const { randomInt } = require("node:crypto");
// Browser fixtures must not inherit an OS-selected low port blocked by Fetch/Chromium.
// Production HOST/PORT configuration is deliberately unaffected.
async function listenLoopback(server) {
  for (let attempt=0;attempt<30;attempt++) {
    const port=randomInt(20000,60000);
    try {
      await new Promise((resolve,reject)=>{
        const failed=error=>{server.off("listening",ready);reject(error);};
        const ready=()=>{server.off("error",failed);resolve();};
        server.once("error",failed);server.once("listening",ready);server.listen(port,"127.0.0.1");
      });
      return port;
    } catch (error) { if(!["EADDRINUSE","EACCES"].includes(error.code))throw error; }
  }
  throw new Error("No available local browser-test port");
}
module.exports={listenLoopback};
