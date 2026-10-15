"use strict";
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, timeout: 60_000,
  reporter: "list", use: { headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), trace: "retain-on-failure" },
});
