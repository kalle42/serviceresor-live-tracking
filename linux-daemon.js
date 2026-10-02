const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

require('./local-env').loadLocalEnvironment(__dirname);
const { USERS, getTodaysTrips, localDateKey } = require('./tracking-service');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROCESS_DIR = path.join(DATA_DIR, 'process-runtime');
const PLAN_FILE = path.join(DATA_DIR, 'todays-trips.json');
const TRACKER_FILE = path.join(__dirname, 'tracking-service.js');
const timers = new Set();
const plannedTrips = new Map();
let planning = false;

fs.mkdirSync(PROCESS_DIR, { recursive: true });

function tripDate(minutes) {
    const date = new Date();
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
}

function scheduleAt(date, callback) {
    const timeout = setTimeout(async () => {
        timers.delete(timeout);
        try { await callback(); } catch (error) { console.error(error.stack || error); }
    }, Math.max(0, date.getTime() - Date.now()));
    timers.add(timeout);
    return timeout;
}

function startTracker(user, trip) {
    const key = `${user.id}-${trip.url}`;
    if (plannedTrips.get(key)?.child) return;
    const child = spawn(process.execPath, [TRACKER_FILE, 'track', user.id, trip.url, trip.time, String(trip.minutes)], {
        cwd: __dirname,
        env: process.env,
        stdio: 'inherit'
    });
    const pidFile = path.join(PROCESS_DIR, `${child.pid}.json`);
    fs.writeFileSync(pidFile, JSON.stringify({ pid: child.pid, userId: user.id, tripTime: trip.time, startedAt: new Date().toISOString() }, null, 2));
    plannedTrips.set(key, { ...plannedTrips.get(key), child });
    console.log(`[${trip.time}] Linux-tracker startad för ${user.id}, pid ${child.pid}.`);
    child.on('exit', (code) => {
        fs.rmSync(pidFile, { force: true });
        plannedTrips.delete(key);
        console.log(`[${trip.time}] Linux-tracker avslutad med kod ${code}.`);
    });
}

async function checkTrip(user, trip, trackingTimer) {
    const current = await getTodaysTrips(user);
    if (current.some((candidate) => candidate.url === trip.url)) {
        console.log(`[${trip.time}] Resan är fortfarande bokad en timme före avgång.`);
        return;
    }
    clearTimeout(trackingTimer);
    timers.delete(trackingTimer);
    plannedTrips.delete(`${user.id}-${trip.url}`);
    console.log(`[${trip.time}] Resan är avbokad; tracking startas inte.`);
}

function scheduleTrip(user, trip) {
    const key = `${user.id}-${trip.url}`;
    if (plannedTrips.has(key)) return;
    const departure = tripDate(trip.minutes);
    const trackingAt = new Date(departure.getTime() - 10 * 60000);
    const expiresAt = new Date(departure.getTime() + 90 * 60000);
    if (Date.now() >= expiresAt.getTime()) return;

    const trackingTimer = scheduleAt(trackingAt, () => startTracker(user, trip));
    const checkAt = new Date(departure.getTime() - 60 * 60000);
    const checkTimer = Date.now() < checkAt.getTime()
        ? scheduleAt(checkAt, () => checkTrip(user, trip, trackingTimer))
        : null;
    plannedTrips.set(key, { trackingTimer, checkTimer });
    console.log(`[${trip.time}] Schemalagd för ${user.id}; kontroll ${checkAt.toLocaleTimeString('sv-SE')}, tracking ${trackingAt.toLocaleTimeString('sv-SE')}.`);
}

async function planToday() {
    if (planning) return;
    planning = true;
    try {
        const plans = [];
        for (const user of USERS) {
            const trips = (await getTodaysTrips(user)).sort((a, b) => a.minutes - b.minutes);
            plans.push({ userId: user.id, trips });
            trips.forEach((trip) => scheduleTrip(user, trip));
        }
        fs.writeFileSync(PLAN_FILE, JSON.stringify({ date: localDateKey(), users: plans }, null, 2));
        console.log(`Linux-planering klar för ${localDateKey()}.`);
    } finally {
        planning = false;
    }
}

function scheduleNextDailyPlan() {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(1, 0, 0, 0);
    scheduleAt(next, async () => {
        plannedTrips.clear();
        await planToday();
        scheduleNextDailyPlan();
    });
    console.log(`Nästa Linux-planering: ${next.toLocaleString('sv-SE')}.`);
}

setInterval(() => {
    const trigger = path.join(DATA_DIR, 'replan.trigger');
    if (fs.existsSync(trigger)) {
        fs.rmSync(trigger, { force: true });
        planToday().catch((error) => console.error(error.stack || error));
    }
}, 15000);

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

async function startPlanner() {
    try {
        await planToday();
        scheduleNextDailyPlan();
    } catch (error) {
        console.error(error.stack || error);
        console.error('Planeringen försöker igen om 60 sekunder.');
        setTimeout(startPlanner, 60000);
    }
}

startPlanner();
