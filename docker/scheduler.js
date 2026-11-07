#!/usr/bin/env node
// Ersätter Windows Task Scheduler i Docker. Samma tider och beteende som
// run-daily-trips.ps1 / run-track-trip.ps1 / run-check-trip.ps1:
//   - planeraren körs 01:00 (och vid start om dagens plan saknas)
//   - check körs 60 minuter före avgång; exit-kod 10 = resan avbokad
//   - spårning körs 10 minuter före avgång
// En enda process, mutex överflödig. Läget skrivs till scheduler-state.json som
// adminpanelen läser, och kommandon kommer via scheduler-command.json.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const NODE = process.execPath;
const STATE_FILE = path.join(ROOT, 'scheduler-state.json');
const COMMAND_FILE = path.join(ROOT, 'scheduler-command.json');
const PLAN_FILE = path.join(ROOT, 'todays-trips.json');

const PLANNER_TASK_NAME = 'Serviceresor daily planner';
const PLAN_HOUR = 1;
const PLANNER_RETRY_MS = 30 * 60 * 1000;
const CHECK_LEAD_MINUTES = 60;
const TRACK_LEAD_MINUTES = 10;
const TRACK_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15 * 60 * 1000;
const TICK_MS = 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function log(message) {
    console.log(`[scheduler] ${new Date().toISOString()} ${message}`);
}

// Klockslag för minuter efter midnatt, samma sätt som run-daily-trips.ps1 räknar.
function midnightPlus(minutes) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setMinutes(minutes);
    return date;
}

// jobb: { name, kind: 'track'|'check', userId, url, time, minutes, runAt, state, lastRun, lastResult }
let jobs = [];
const children = new Map(); // jobbnamn -> { child, kind, command, startedAt }
const planner = { running: false, lastRun: null, lastResult: null, lastAttempt: 0 };

function nextPlannerRun() {
    const next = new Date();
    next.setHours(PLAN_HOUR, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next.toISOString();
}

function persistState() {
    const tasks = [{
        name: PLANNER_TASK_NAME,
        state: planner.running ? 'Running' : 'Ready',
        nextRun: nextPlannerRun(),
        lastRun: planner.lastRun,
        lastResult: planner.lastResult
    }, ...jobs.map((job) => ({
        name: job.name,
        state: job.state,
        nextRun: job.state === 'Ready' ? new Date(job.runAt).toISOString() : null,
        lastRun: job.lastRun,
        lastResult: job.lastResult
    }))];
    const processes = [...children.values()].map((entry) => ({
        id: entry.child.pid,
        command: entry.command,
        created: new Date(entry.startedAt).toISOString(),
        kind: entry.kind
    }));
    const temporary = `${STATE_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ generatedAt: new Date().toISOString(), tasks, processes }, null, 2));
    fs.renameSync(temporary, STATE_FILE);
}

// Bygg om resejobben från dagens plan. Pågående körningar får inte störas.
function rebuildJobsFromPlan() {
    const running = jobs.filter((job) => job.state === 'Running');
    jobs = running;
    const plan = readJson(PLAN_FILE, null);
    if (!plan || plan.date !== localDateKey()) return;
    for (const userPlan of plan.users || []) {
        for (const trip of userPlan.trips || []) {
            const stamp = String(trip.time).replace(':', '');
            const trackAt = midnightPlus(trip.minutes - TRACK_LEAD_MINUTES).getTime();
            const checkAt = midnightPlus(trip.minutes - CHECK_LEAD_MINUTES).getTime();
            // Samma villkor som PowerShell: schemalägg bara tider som ligger framåt.
            if (checkAt > Date.now() && !jobs.some((job) => job.kind === 'check' && job.userId === userPlan.userId && job.time === trip.time)) {
                jobs.push({
                    name: `Fardtjanst-trip-check-${plan.date}-${userPlan.userId}-${stamp}`,
                    kind: 'check', userId: userPlan.userId, url: trip.url, time: trip.time,
                    minutes: trip.minutes, runAt: checkAt, state: 'Ready', lastRun: null, lastResult: null
                });
            }
            if (trackAt > Date.now() && !jobs.some((job) => job.kind === 'track' && job.userId === userPlan.userId && job.time === trip.time)) {
                jobs.push({
                    name: `Fardtjanst-trip-${plan.date}-${userPlan.userId}-${stamp}`,
                    kind: 'track', userId: userPlan.userId, url: trip.url, time: trip.time,
                    minutes: trip.minutes, runAt: trackAt, state: 'Ready', lastRun: null, lastResult: null
                });
            }
        }
    }
    log(`Resejobb planerade: ${jobs.length} st.`);
}

function openLog(file) {
    return fs.openSync(path.join(ROOT, file), 'a');
}

function registerChild(job, child, command, timeoutMs) {
    const entry = { child, kind: job.kind, command, startedAt: Date.now() };
    children.set(job.name, entry);
    const timer = setTimeout(() => {
        log(`${job.name} överskred tidsgränsen och dödas.`);
        child.kill('SIGKILL');
    }, timeoutMs);
    child.on('exit', (code, signal) => {
        clearTimeout(timer);
        children.delete(job.name);
        job.state = 'Ready';
        job.lastRun = new Date().toISOString();
        job.lastResult = code === null ? `killed:${signal}` : code;
        if (job.kind === 'check' && code === 10) {
            cancelTrackFor(job);
        }
    });
}

// run-check-trip.ps1 avregistrerade spårningsuppgiften vid avbokad resa.
function cancelTrackFor(job) {
    const target = jobs.find((candidate) => candidate.kind === 'track'
        && candidate.userId === job.userId && candidate.time === job.time && candidate.state !== 'Running');
    if (target) {
        jobs = jobs.filter((candidate) => candidate !== target);
        log(`Resan ${job.time} (${job.userId}) är avbokad – spårningen avregistrerades.`);
    }
}

function startTrack(job) {
    job.state = 'Running';
    const stamp = job.time.replace(':', '');
    const args = ['tracking-service.js', 'track', job.userId, job.url, job.time, String(job.minutes)];
    const child = spawn(NODE, args, { cwd: ROOT, stdio: ['ignore', openLog(`trip-${stamp}.log`), openLog(`trip-${stamp}-error.log`)] });
    registerChild(job, child, `node ${args.join(' ')}`, TRACK_TIMEOUT_MS);
    log(`Spårning startad för ${job.time} (${job.userId}).`);
}

function startCheck(job) {
    job.state = 'Running';
    const stamp = job.time.replace(':', '');
    const args = ['tracking-service.js', 'check', job.userId, job.url, job.time];
    const child = spawn(NODE, args, { cwd: ROOT, stdio: ['ignore', openLog(`trip-${stamp}-status.log`), openLog(`trip-${stamp}-status-error.log`)] });
    registerChild(job, child, `node ${args.join(' ')}`, CHECK_TIMEOUT_MS);
    log(`Kontroll startad för ${job.time} (${job.userId}).`);
}

function runPlanner(reason) {
    if (planner.running) return;
    planner.running = true;
    planner.lastAttempt = Date.now();
    const args = ['tracking-service.js'];
    // 'w' som Start-Process -RedirectStandardOutput: varje körning börjar om loggen.
    const child = spawn(NODE, args, {
        cwd: ROOT,
        stdio: ['ignore', fs.openSync(path.join(ROOT, 'daily-trips.log'), 'w'), fs.openSync(path.join(ROOT, 'daily-trips-error.log'), 'w')]
    });
    children.set(PLANNER_TASK_NAME, { child, kind: 'planner', command: 'node tracking-service.js', startedAt: Date.now() });
    child.on('exit', (code, signal) => {
        children.delete(PLANNER_TASK_NAME);
        planner.running = false;
        planner.lastRun = new Date().toISOString();
        planner.lastResult = code === null ? `killed:${signal}` : code;
        rebuildJobsFromPlan();
        log(`Planeraren slutade med kod ${planner.lastResult}.`);
    });
    log(`Planeraren startad (${reason}).`);
}

function maybeRunPlanner() {
    const plan = readJson(PLAN_FILE, null);
    const stale = !plan || plan.date !== localDateKey();
    const now = new Date();
    const pastPlannedHour = now.getHours() > PLAN_HOUR || (now.getHours() === PLAN_HOUR && now.getMinutes() >= 0);
    if (stale && pastPlannedHour && !planner.running && Date.now() - planner.lastAttempt > PLANNER_RETRY_MS) {
        runPlanner('dagens plan saknas');
    }
}

// stop-sessions i run-daily-trips.ps1-världen: avregistrera resejobben och
// döda pågående spårningar. Planeraren får fortsätta.
function stopTripJobs() {
    jobs = jobs.filter((job) => job.state === 'Running');
    for (const entry of children.values()) {
        if (entry.kind !== 'track') continue;
        entry.child.kill('SIGTERM');
        setTimeout(() => {
            if (entry.child.exitCode === null && !entry.child.killed) entry.child.kill('SIGKILL');
        }, 3000);
    }
    log('Alla planerade resejobb avregistrerade.');
}

function handleCommands() {
    if (!fs.existsSync(COMMAND_FILE)) return;
    let command = null;
    try {
        command = readJson(COMMAND_FILE, null);
        fs.rmSync(COMMAND_FILE, { force: true });
    } catch {
        return;
    }
    if (!command) return;
    if (command.command === 'run-planner') runPlanner('begärd från adminpanelen');
    else if (command.command === 'stop-sessions') stopTripJobs();
}

function fireDueJobs() {
    for (const job of jobs) {
        if (job.state !== 'Ready' || job.runAt > Date.now()) continue;
        if (job.kind === 'track') startTrack(job);
        else startCheck(job);
    }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        log(`Avslutar på ${signal}.`);
        for (const entry of children.values()) entry.child.kill('SIGTERM');
        setTimeout(() => process.exit(0), 500);
    });
}

process.on('uncaughtException', (error) => {
    console.error('[scheduler] Oväntat fel:', error.stack || error);
});
process.on('unhandledRejection', (error) => {
    console.error('[scheduler] Oväntat fel:', error && (error.stack || error));
});

async function main() {
    log(`Schemaläggaren startad (TZ=${process.env.TZ || 'systemets tidzon'}).`);
    rebuildJobsFromPlan();
    persistState();
    while (true) {
        try {
            handleCommands();
            maybeRunPlanner();
            fireDueJobs();
            persistState();
        } catch (error) {
            console.error('[scheduler] Fel i huvudloopen:', error.stack || error);
        }
        await delay(TICK_MS);
    }
}

main();
