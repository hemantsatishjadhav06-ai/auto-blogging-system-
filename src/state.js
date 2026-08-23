'use strict';
/** Shared run-state: one mutex across cron, /run/* endpoints, and the admin hub. */
const state = { running: false, lastRun: null, startedAt: Date.now() };
module.exports = state;
