'use strict';

const cron = require('node-cron');
const rollup = require('./operations/rollup');
const logService = require('../../services/logService');
const { getConfig } = require('../../config/config');

const config = getConfig();

const RECOMPUTE_CRON = process.env.GOALSHQ_RECOMPUTE_CRON || '*/15 * * * *';
const GC_CRON = process.env.GOALSHQ_GC_CRON || '30 3 * * *'; // nightly 03:30
const STALE_MINUTES = parseInt(process.env.GOALSHQ_STALE_MINUTES || '20', 10);

const state = {
    initialized: false,
    jobs: [],
    running: false,
};

function isDisabled() {
    return (
        config.environment === 'test' ||
        config.disableScheduler ||
        process.env.GOALSHQ_ENABLED === 'false'
    );
}

async function runRecompute() {
    if (state.running) return;
    state.running = true;
    try {
        const n = await rollup.recomputeStale(STALE_MINUTES, {
            source: 'cron',
        });
        if (n > 0) {
            logService.logInfo(`[goalshq] cron recomputed ${n} stale goal(s)`);
        }
    } catch (err) {
        logService.logError(
            `[goalshq] cron recompute failed: ${err.message}`,
            err
        );
    } finally {
        state.running = false;
    }
}

async function runGc() {
    try {
        await rollup.gcOrphans();
    } catch (err) {
        logService.logError(`[goalshq] cron gc failed: ${err.message}`, err);
    }
}

/**
 * Idempotent. Called from backend/app.js's startServer(), alongside
 * taskScheduler/caldavSyncScheduler. Safe to call repeatedly.
 */
function initialize() {
    if (state.initialized) return state;
    if (isDisabled()) {
        state.initialized = true;
        return state;
    }
    if (!cron.validate(RECOMPUTE_CRON)) {
        logService.logError(
            `[goalshq] invalid GOALSHQ_RECOMPUTE_CRON "${RECOMPUTE_CRON}" — scheduler not started`
        );
        state.initialized = true;
        return state;
    }

    state.jobs.push(cron.schedule(RECOMPUTE_CRON, runRecompute));
    if (cron.validate(GC_CRON)) {
        state.jobs.push(cron.schedule(GC_CRON, runGc));
    }
    state.initialized = true;
    logService.logInfo(
        `[goalshq] scheduler started (recompute "${RECOMPUTE_CRON}", gc "${GC_CRON}")`
    );
    return state;
}

function stop() {
    state.jobs.forEach((job) => job.stop());
    state.jobs = [];
    state.initialized = false;
}

function getStatus() {
    return { initialized: state.initialized, jobs: state.jobs.length };
}

module.exports = { initialize, stop, getStatus, runRecompute, runGc };
