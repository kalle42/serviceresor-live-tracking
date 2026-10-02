const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');

require('./local-env').loadLocalEnvironment(__dirname);

const SERVICE_URL = 'https://minaserviceresor.goteborg.se';
const SHARE_API_KEY = process.env.HERENOW_API_KEY || fs.readFileSync(
    path.join(os.homedir(), '.herenow', 'credentials'),
    'utf8'
).trim();
const USERS = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.local.json'), 'utf8')).users;
const SESSION_RUNTIME_DIR = path.join(__dirname, 'session-runtime');
const MINUTES_BEFORE_DEPARTURE = 10;
const MINUTES_AFTER_DEPARTURE = 90;
const SESSION_URL_LIFETIME_MINUTES = 60;
const VEHICLE_NUMBER_CHECK_INTERVAL_MS = 10000;
const POSITION_HEARTBEAT_INTERVAL_MS = 30000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function registerSession(session, shareUrl, trip, user, expiresAt) {
    fs.mkdirSync(SESSION_RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSION_RUNTIME_DIR, `${session.slug}.json`), JSON.stringify({
        slug: session.slug,
        siteUrl: session.siteUrl,
        mapUrl: shareUrl,
        userId: user.id,
        tripTime: trip.time,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(expiresAt).toISOString()
    }, null, 2));
}

function unregisterSession(slug) {
    fs.rmSync(path.join(SESSION_RUNTIME_DIR, `${slug}.json`), { force: true });
}

function updateSessionMetadata(slug, metadata) {
    const file = path.join(SESSION_RUNTIME_DIR, `${slug}.json`);
    try {
        const current = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify({ ...current, ...metadata }, null, 2));
    } catch {
        // Sessionen kan ha stängts medan ett asynkront svar fortfarande väntade.
    }
}

process.on('uncaughtException', (error) => console.error('Oväntat processfel:', error.stack || error));
process.on('unhandledRejection', (error) => console.error('Ohanterat asynkront fel:', error.stack || error));

async function clickExactText(page, text, timeout = 30000) {
    await page.waitForFunction(
        (target) => Array.from(document.querySelectorAll('a, button, [role="button"]'))
            .some((element) => element.textContent.trim() === target),
        { timeout },
        text
    );
    await page.evaluate((target) => {
        Array.from(document.querySelectorAll('a, button, [role="button"]'))
            .find((element) => element.textContent.trim() === target)
            .click();
    }, text);
}

async function clickExactTextIfVisible(page, text, timeout = 3000) {
    try {
        await clickExactText(page, text, timeout);
        return true;
    } catch {
        return false;
    }
}

async function login(page, user) {
    await page.goto(SERVICE_URL, { waitUntil: 'networkidle2' });
    await clickExactTextIfVisible(page, 'Jag förstår');
    await clickExactText(page, 'Privat');
    await page.waitForFunction(() => document.body.innerText.includes('Lösenord'), { timeout: 30000 });
    await clickExactText(page, 'Lösenord');

    const ssnInput = await page.waitForSelector(
        '#ssn, input[name="ssn"], input[autocomplete="username"], input[type="text"]',
        { timeout: 30000 }
    );
    const passwordInput = await page.waitForSelector(
        '#password, input[name="password"], input[type="password"]',
        { timeout: 30000 }
    );
    await ssnInput.type(user.ssn);
    await passwordInput.type(user.password);
    await clickExactText(page, 'Logga in');
    await page.waitForFunction(
        () => ['/boka-resa', '/boka', '/resor'].includes(location.pathname),
        { timeout: 30000 }
    );
}

async function loginWithRetry(page, user, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await login(page, user);
            return;
        } catch (error) {
            lastError = error;
            console.error(`Inloggning misslyckades, försök ${attempt}/${attempts}: ${error.message}`);
            if (attempt < attempts) {
                await page.goto(SERVICE_URL, { waitUntil: 'networkidle2' }).catch(() => {});
                await delay(1500);
            }
        }
    }
    throw lastError;
}

async function launchBrowser() {
    return puppeteer.launch({
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-gpu',
            '--no-first-run',
            `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'daily-trips-'))}`
        ]
    });
}

function tripDate(minutes) {
    const date = new Date();
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
}

async function getTodaysTrips(user) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const browser = await launchBrowser();
        try {
            const page = await browser.newPage();
            await login(page, user);
            await page.goto(`${SERVICE_URL}/resor`, { waitUntil: 'networkidle2' });
            await page.waitForFunction(() => document.body.innerText.trim() !== 'Laddar...', { timeout: 60000 });

            const hasMore = await page.evaluate(() => Array.from(document.querySelectorAll('button, a, [role="button"]'))
                .some((element) => element.textContent.trim() === 'Visa fler resor'));
            if (hasMore) {
                await clickExactText(page, 'Visa fler resor');
                await delay(3000);
            }

            const trips = await page.evaluate(() => {
                const datePattern = /^(Idag|Imorgon|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(\s+\d{1,2}\s+\S+)?$/i;
                const dateHeadings = Array.from(document.querySelectorAll('body *'))
                    .filter((element) => element.children.length === 0 && datePattern.test(element.textContent.trim()));
                const todayHeading = dateHeadings.find((element) => element.textContent.trim() === 'Idag');
                if (!todayHeading) return [];

                const nextHeading = dateHeadings.find((element) =>
                    Boolean(todayHeading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
                );

                return Array.from(document.querySelectorAll('a[href*="/resor/bokning/"]'))
                    .filter((link) => {
                        const afterToday = Boolean(todayHeading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
                        const beforeNextDate = !nextHeading ||
                            Boolean(link.compareDocumentPosition(nextHeading) & Node.DOCUMENT_POSITION_FOLLOWING);
                        return afterToday && beforeNextDate;
                    })
                    .map((link) => {
                        const match = link.innerText.match(/\b(\d{1,2}):(\d{2})\b/);
                        return match ? {
                            url: link.href,
                            time: `${match[1].padStart(2, '0')}:${match[2]}`,
                            minutes: Number(match[1]) * 60 + Number(match[2])
                        } : null;
                    })
                    .filter(Boolean);
            });
            return Array.from(new Map(trips.map((trip) => [trip.url, trip])).values());
        } catch (error) {
            lastError = error;
            console.error(`Försök ${attempt}/3 att läsa resor misslyckades:`, error.message);
        } finally {
            await browser.close().catch(() => {});
        }
    }
    throw lastError;
}

function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function createSessionSite() {
    const bash = process.env.GIT_BASH_PATH || 'C:\\Program Files\\Git\\bin\\bash.exe';
    const publishScript = process.env.HERENOW_PUBLISH_SCRIPT;
    if (!publishScript) throw new Error('HERENOW_PUBLISH_SCRIPT saknas.');
    const toPosix = (value) => value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
    const target = toPosix(path.join(__dirname, 'session-map'));
    const publisher = toPosix(publishScript);
    const adapter = toPosix(path.join(__dirname, 'tools', 'sha256sum'));
    const command = `chmod +x "${adapter}"; export PATH="${path.posix.dirname(adapter)}:$PATH"; "${publisher}" "${target}" --ttl 3600 --client opencode`;
    const result = spawnSync(bash, ['-c', command], {
        cwd: __dirname,
        encoding: 'utf8',
        env: {
            ...process.env,
            HERENOW_API_KEY: SHARE_API_KEY
        }
    });
    if (result.status !== 0) {
        throw new Error(`Sessionskartan kunde inte publiceras: ${result.stderr || result.stdout}`);
    }
    const siteUrl = result.stdout.match(/https:\/\/[a-z0-9-]+\.here\.now\//)?.[0];
    if (!siteUrl) throw new Error('Publiceringen returnerade ingen kartlänk.');
    return { siteUrl, slug: new URL(siteUrl).hostname.split('.')[0] };
}

async function deleteSessionSite(slug) {
    const response = await fetch(`https://here.now/api/v1/publish/${slug}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${SHARE_API_KEY}` }
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(`Sessionskartan kunde inte tas bort (${response.status}).`);
    }
}

async function sendTrackingSms(to, url, time) {
    const username = process.env.ELKS_API_USERNAME;
    const password = process.env.ELKS_API_PASSWORD;
    if (!username || !password) throw new Error('46elks API-uppgifter saknas.');
    const body = new URLSearchParams({
        from: 'Serviceresa',
        to,
        message: `Följ resan ${time}: ${url}`,
        dontlog: 'message'
    });
    const response = await fetch('https://api.46elks.com/a1/sms', {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
        body
    });
    if (!response.ok) throw new Error(`SMS kunde inte skickas (${response.status}).`);
    return response.json();
}

async function sendTrackingTextBee(recipients, url, time) {
    const apiKey = process.env.TEXTBEE_API_KEY;
    if (!apiKey) throw new Error('TextBee API-nyckel saknas.');
    if (!recipients.length) throw new Error('TextBee saknar mottagare.');
    if (recipients.some((number) => !/^\+[1-9]\d{7,14}$/.test(number))) {
        throw new Error('En TextBee-mottagare har ogiltigt E.164-format.');
    }

    const baseUrl = (process.env.TEXTBEE_BASE_URL || 'https://api.textbee.dev/api/v1').replace(/\/$/, '');
    const payload = { recipients, message: `Följ resan ${time}: ${url}` };
    if (process.env.TEXTBEE_DEVICE_ID) payload.deviceId = process.env.TEXTBEE_DEVICE_ID;
    const response = await fetch(`${baseUrl}/gateway/send-sms`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.data?.success === false) {
        throw new Error(`TextBee kunde inte skicka SMS (${response.status}): ${result.message || result.error || 'okänt fel'}`);
    }
    return result;
}

async function sendTrackingNtfy(topic, url, time) {
    if (!/^[-_A-Za-z0-9]{1,64}$/.test(topic)) {
        throw new Error('ntfy-topic har ogiltigt format.');
    }

    const server = (process.env.NTFY_SERVER_URL || 'https://ntfy.sh').replace(/\/$/, '');
    const headers = {
        Title: `Serviceresa ${time}`,
        Priority: 'high',
        Tags: 'car',
        Click: url
    };
    if (process.env.NTFY_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${process.env.NTFY_ACCESS_TOKEN}`;
    }

    const response = await fetch(`${server}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers,
        body: `Livekartan för resan ${time} är tillgänglig i 60 minuter.`
    });
    if (!response.ok) {
        throw new Error(`ntfy kunde inte skicka notisen (${response.status}).`);
    }
    return response.json();
}

function encryptPayload(payload, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return {
        ciphertext: base64Url(Buffer.concat([encrypted, cipher.getAuthTag()])),
        iv: base64Url(iv)
    };
}

async function trackTrip(trip, user) {
    const smsRecipients = (Array.isArray(user.smsTo) ? user.smsTo : [user.smsTo]).filter(Boolean);
    const ntfyTopics = (Array.isArray(user.ntfyTopics) ? user.ntfyTopics : [user.ntfyTopics]).filter(Boolean);
    const textBeeRecipients = (Array.isArray(user.textbeeTo) ? user.textbeeTo : [user.textbeeTo]).filter(Boolean);
    if (smsRecipients.length === 0 && ntfyTopics.length === 0 && textBeeRecipients.length === 0) {
        console.log(`[${trip.time}] Ingen SMS-, TextBee- eller ntfy-mottagare för ${user.id}; spårningen hoppas över.`);
        return;
    }

    const browser = await launchBrowser();
    const sessionKey = crypto.randomBytes(32);
    let session = createSessionSite();
    const sessionExpiresAt = Date.now() + SESSION_URL_LIFETIME_MINUTES * 60000;
    let shareUrl = `${session.siteUrl}#${base64Url(sessionKey)}`;
    registerSession(session, shareUrl, trip, user, sessionExpiresAt);
    let recordId;
    let route;
    let lastVehicle;
    let vehicleNumber;
    let writeQueue = Promise.resolve();
    let sessionRotationCount = 0;

    async function deliverShareLink(url) {
        const smsResults = await Promise.allSettled(smsRecipients.map((recipient) =>
            sendTrackingSms(recipient, url, trip.time)
        ));
        const ntfyResults = await Promise.allSettled(ntfyTopics.map((topic) =>
            sendTrackingNtfy(topic, url, trip.time)
        ));
        const textBeeResults = textBeeRecipients.length === 0 ? [] : [await sendTrackingTextBee(textBeeRecipients, url, trip.time)
            .then(() => ({ status: 'fulfilled' }))
            .catch((reason) => ({ status: 'rejected', reason }))];
        const sentSmsCount = smsResults.filter((result) => result.status === 'fulfilled').length;
        const sentNtfyCount = ntfyResults.filter((result) => result.status === 'fulfilled').length;
        const sentTextBeeCount = textBeeResults.filter((result) => result.status === 'fulfilled').length;
        smsResults.forEach((result, index) => {
            if (result.status === 'rejected') console.error(`[${trip.time}] SMS till ${smsRecipients[index]} misslyckades: ${result.reason.message}`);
        });
        ntfyResults.forEach((result) => {
            if (result.status === 'rejected') console.error(`[${trip.time}] ntfy-notis misslyckades: ${result.reason.message}`);
        });
        textBeeResults.forEach((result) => {
            if (result.status === 'rejected') console.error(`[${trip.time}] TextBee-SMS misslyckades: ${result.reason.message}`);
        });
        if (sentSmsCount + sentNtfyCount + sentTextBeeCount === 0) {
            throw new Error('Spårningslänken kunde inte skickas via någon kanal.');
        }
        console.log(`[${trip.time}] Länk skickad via ${sentSmsCount} SMS, ${sentTextBeeCount} TextBee och ${sentNtfyCount} ntfy.`);
    }

    async function rotateSession() {
        if (sessionRotationCount >= 1) throw new Error('Sessionskartan försvann igen efter rotation.');
        sessionRotationCount += 1;
        await deleteSessionSite(session.slug).catch(() => {});
        unregisterSession(session.slug);
        session = createSessionSite();
        shareUrl = `${session.siteUrl}#${base64Url(sessionKey)}`;
        recordId = undefined;
        registerSession(session, shareUrl, trip, user, sessionExpiresAt);
        await deliverShareLink(shareUrl);
        console.log(`[${trip.time}] Ny sessionskarta skapad efter 404 och ny länk skickad.`);
    }

    async function updateVehicleNumberFromHeader(page) {
        const number = await page.evaluate(() => {
            const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]'));
            for (const heading of headings) {
                const match = heading.textContent.trim().match(/(?:,\s*|\b)(\d{3})\s*$/);
                if (match) return match[1];
            }

            return document.title.match(/(?:,\s*|\b)(\d{3})\s*$/)?.[1] || null;
        });
        if (!number) return;
        if (number === vehicleNumber) return;

        vehicleNumber = number;
        updateSessionMetadata(session.slug, { vehicleNumber });
        if (route || lastVehicle) {
            await writeSharedData({
                recorded_at: new Date().toISOString(),
                ...lastVehicle,
                ...route,
                vehicle_number: vehicleNumber
            });
        }
        console.log(`[${trip.time}] Fordonsnummer ${vehicleNumber} läst från sidhuvudet.`);
    }

    async function writeSharedData(data) {
        writeQueue = writeQueue.catch(() => {}).then(async () => {
            const sharedData = {
                ...data,
                vehicle_number: vehicleNumber || data.vehicle_number || ''
            };
            for (let attempt = 1; attempt <= 3; attempt += 1) {
                const endpoint = recordId
                    ? `https://here.now/api/v1/publishes/${session.slug}/data/positions/${recordId}`
                    : `https://here.now/api/v1/publishes/${session.slug}/data/positions`;
                const response = await fetch(endpoint, {
                    method: recordId ? 'PATCH' : 'POST',
                    headers: {
                        Authorization: `Bearer ${SHARE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(encryptPayload(sharedData, sessionKey))
                });
                if (response.ok) {
                    recordId = (await response.json()).record.id;
                    return;
                }

                if (response.status === 404 && attempt === 1) {
                    await rotateSession();
                    continue;
                }

                const detail = (await response.text()).slice(0, 300);
                if (attempt === 3) {
                    throw new Error(`Kartdata kunde inte publiceras (${response.status}): ${detail}`);
                }
                await delay(attempt * 1000);
            }
        });
        return writeQueue;
    }

    try {
        await deliverShareLink(shareUrl);
        const page = await browser.newPage();
        page.on('response', (response) => {
            const contentType = response.headers()['content-type'] || '';
            const responsePath = new URL(response.url()).pathname;
            if (!contentType.includes('application/json')) return;

            if (/\/v2\/trips\/vehicleinfo\//.test(responsePath)) {
                response.json().then(async (payload) => {
                    const info = payload?.data || payload;
                    if (info?.vehicleNbr !== undefined && Number(info.vehicleNbr) !== 0) {
                        vehicleNumber = String(info.vehicleNbr);
                        updateSessionMetadata(session.slug, { vehicleNumber });
                        if (route || lastVehicle) {
                            await writeSharedData({ recorded_at: new Date().toISOString(), ...lastVehicle, ...route, vehicle_number: vehicleNumber });
                        }
                        console.log(`[${trip.time}] Fordonsnummer läst.`);
                    }
                }).catch((error) => console.error(`[${trip.time}] Kunde inte läsa fordonsinfo:`, error.message));
                return;
            }

            if (!/\/v2\/d\/trips\/\d+$/.test(responsePath)) return;

            response.json().then(async (payload) => {
                const tripData = payload?.data;
                const pickup = tripData?.pickup?.location;
                const dropoff = tripData?.dropoff?.location;
                const values = [pickup?.lat, pickup?.lon, dropoff?.lat, dropoff?.lon].map(Number);
                if (!values.every(Number.isFinite)) return;

                route = {
                    pickup_latitude: values[0],
                    pickup_longitude: values[1],
                    dropoff_latitude: values[2],
                    dropoff_longitude: values[3],
                    vehicle_number: vehicleNumber || '',
                    first_name: String(tripData?.travellers?.[0]?.displayName || '').trim().split(/\s+/)[0],
                    pickup_address: tripData?.pickup?.displayAddress || '',
                    dropoff_address: tripData?.dropoff?.displayAddress || ''
                };
                updateSessionMetadata(session.slug, {
                    firstName: route.first_name,
                    pickupAddress: route.pickup_address,
                    dropoffAddress: route.dropoff_address,
                    vehicleNumber: route.vehicle_number || vehicleNumber || ''
                });
                await writeSharedData({ recorded_at: new Date().toISOString(), ...lastVehicle, ...route });
                console.log(`[${trip.time}] Från och Till publicerade.`);
            }).catch((error) => console.error(`[${trip.time}] Kunde inte läsa resdata:`, error.message));
        });

        await page.exposeFunction('publishDailyVehiclePosition', async (latitude, longitude) => {
            if (![latitude, longitude].every(Number.isFinite) || latitude === 0 || longitude === 0) return;
            lastVehicle = { latitude, longitude };
            await writeSharedData({ recorded_at: new Date().toISOString(), ...lastVehicle, ...route });
            console.log(`[${trip.time}] Bilposition publicerad: ${latitude}, ${longitude}`);
        });
        await page.evaluateOnNewDocument(() => {
            const NativeEventSource = window.EventSource;
            window.EventSource = class ForwardingEventSource extends NativeEventSource {
                constructor(url, options) {
                    super(url, options);
                    this.addEventListener('message', (event) => {
                        try {
                            const { lat, lon } = JSON.parse(event.data);
                            window.publishDailyVehiclePosition(Number(lat), Number(lon)).catch(console.error);
                        } catch (error) {
                            console.error(error);
                        }
                    });
                }
            };
        });

        await loginWithRetry(page, user);
        await page.goto(trip.url, { waitUntil: 'networkidle2' });
        await updateVehicleNumberFromHeader(page);
        console.log(`[${trip.time}] Spårning startad.`);

        const trackingStopAt = tripDate(trip.minutes + MINUTES_AFTER_DEPARTURE).getTime();
        const stopAt = Math.min(trackingStopAt, sessionExpiresAt);
        let lastHeartbeatAt = 0;
        while (Date.now() < stopAt) {
            await delay(VEHICLE_NUMBER_CHECK_INTERVAL_MS);
            await updateVehicleNumberFromHeader(page);
            if (lastVehicle && Date.now() - lastHeartbeatAt >= POSITION_HEARTBEAT_INTERVAL_MS) {
                await writeSharedData({
                    recorded_at: new Date().toISOString(),
                    ...lastVehicle,
                    ...route,
                    vehicle_number: vehicleNumber || route?.vehicle_number || ''
                });
                lastHeartbeatAt = Date.now();
            }
        }
        console.log(`[${trip.time}] Spårning avslutad; sessionslänkens 60-minutersgräns nåddes.`);
    } finally {
        await browser.close().catch(() => {});
        await deleteSessionSite(session.slug);
        unregisterSession(session.slug);
        console.log(`[${trip.time}] Sessionskartan stängdes och togs bort.`);
    }
}

async function main() {
    console.log(`Daglig kontroll startad ${new Date().toLocaleString('sv-SE')}.`);
    let trips;
    try {
        const plans = [];
        for (const user of USERS) {
            const userTrips = (await getTodaysTrips(user)).sort((a, b) => a.minutes - b.minutes);
            plans.push({ userId: user.id, trips: userTrips });
        }
        trips = plans.flatMap((plan) => plan.trips);
        fs.writeFileSync(
            path.join(__dirname, 'todays-trips.json'),
            JSON.stringify({ date: localDateKey(), users: plans }, null, 2)
        );
    } catch (error) {
        console.error('Kunde inte läsa dagens resor:', error.stack || error);
        throw error;
    }
    console.log(`Hittade ${trips.length} resor idag: ${trips.map((trip) => trip.time).join(', ') || 'inga'}.`);

    console.log('Dagens separata reseuppgifter kan nu schemaläggas.');
}

async function runTrackedTrip() {
    const [, , mode, userId, url, time, minutes] = process.argv;
    if (mode !== 'track' || !userId || !url || !time || !Number.isFinite(Number(minutes))) {
        throw new Error('Resans URL, tid eller minuter saknas.');
    }

    const user = USERS.find((candidate) => candidate.id === userId);
    if (!user) throw new Error(`Okänd användare: ${userId}`);
    const trip = { url, time, minutes: Number(minutes) };
    console.log(`[${time}] Schemalagd reseprocess startad.`);
    await trackTrip(trip, user);
}

async function checkTripStatus() {
    const [, , mode, userId, url, time] = process.argv;
    if (mode !== 'check' || !userId || !url || !time) {
        throw new Error('Kontrollens användare, URL eller tid saknas.');
    }

    const user = USERS.find((candidate) => candidate.id === userId);
    if (!user) throw new Error(`Okänd användare: ${userId}`);
    const trips = await getTodaysTrips(user);
    const stillBooked = trips.some((trip) => trip.url === url);
    if (!stillBooked) {
        console.log(`[${time}] Resan finns inte längre i dagens resor och behandlas som avbokad.`);
        process.exitCode = 10;
        return;
    }

    console.log(`[${time}] Resan är fortfarande bokad en timme före avgång.`);
}

const operation = process.argv[2] === 'track'
    ? runTrackedTrip
    : process.argv[2] === 'check'
        ? checkTripStatus
        : main;
operation().catch((error) => {
    console.error('Dagsprocessen avslutades med fel:', error.stack || error);
    process.exitCode = 1;
});
