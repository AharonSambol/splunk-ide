'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './test/smoke',
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [['list']],
});
