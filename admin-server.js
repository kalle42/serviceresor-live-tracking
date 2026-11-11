const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const { loadLocalEnvironment, resolvePublishScript, resolveGitBash } = require('./local-env');
loadLocalEnvironment(__dirname);

const execFileAsync = promisify(execFile);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'admin-dashboard');
const USERS_FILE = path.join(ROOT, 'users.local.json');
const LOCAL_ENV_FILE = path.join(ROOT, '.env.local.json');
const SESSION_RUNTIME_DIR = path.join(ROOT, 'session-runtime');
const HOST = process.env.ADMIN_DASHBOARD_HOST || '127.0.0.1';
const PORT = Number(process.env.ADMIN_DASHBOARD_PORT || 8787);
const ADMIN_USER = process.env.ADMIN_DASHBOARD_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_DASHBOARD_PASSWORD;

if (!ADMIN_PASSWORD) throw new Error('ADMIN_DASHBOARD_PASSWORD is required.');

function sendJson(response, status, payload) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer'
    });
    response.end(JSON.stringify(payload));
}

function isAuthenticated(request) {
    const header = request.headers.authorization || '';
    if (!header.startsWith('Basic ')) return false;
    const value = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = value.indexOf(':');
    return separator !== -1 && value.slice(0, separator) === ADMIN_USER && value.slice(separator + 1) === ADMIN_PASSWORD;
}

function requireAuth(request, response) {
    if (isAuthenticated(request)) return true;
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Serviceresor Admin"' });
    response.end('Authentication required');
    return false;
}

function requireAction(request, response) {
    if (request.headers['x-admin-action'] === 'true') return true;
    sendJson(response, 403, { error: 'Missing action confirmation.' });
    return false;
}

async function readBody(request) {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 131072) throw new Error('Request body is too large.');
        chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function readUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function maskedUsers() {
    return readUsers().users.map((user) => ({
        id: user.id,
        ssnMasked: user.ssn ? `${user.ssn.slice(0, 4)}****-****` : 'saknas',
        hasPassword: Boolean(user.password),
        smsTo: user.smsTo || [],
        textbeeTo: user.textbeeTo || [],
        ntfyTopics: user.ntfyTopics || []
    }));
}

function validateUser(input, existing) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(input.id || '')) throw new Error('User id is invalid.');
    const smsTo = (Array.isArray(input.smsTo) ? input.smsTo : []).filter(Boolean);
    if (smsTo.some((number) => !/^\+[1-9]\d{7,14}$/.test(number))) throw new Error('An SMS number is invalid.');
    const textbeeTo = (Array.isArray(input.textbeeTo) ? input.textbeeTo : []).filter(Boolean);
    if (textbeeTo.some((number) => !/^\+[1-9]\d{7,14}$/.test(number))) throw new Error('A TextBee number is invalid.');
    const ntfyTopics = (Array.isArray(input.ntfyTopics) ? input.ntfyTopics : []).filter(Boolean);
    if (ntfyTopics.some((topic) => !/^[-_A-Za-z0-9]{1,64}$/.test(topic))) throw new Error('An ntfy topic is invalid.');
    // Tomt fält betyder "behåll det sparade värdet"; rensa-flaggor tar bort det.
    // Personnummer/lösenord får vara borttagna – då hoppar planering och spårning
    // över användaren med ett loggmeddelande i stället för att krascha dagens körning.
    const ssn = input.clearSsn ? '' : (input.ssn || existing?.ssn || '');
    const password = input.clearPassword ? '' : (input.password || existing?.password || '');
    return { id: input.id, ssn, password, smsTo, textbeeTo, ntfyTopics };
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function tail(file, count = 60) {
    try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-count); } catch { return []; }
}

function activeSessions() {
    try {
        const now = Date.now();
        return fs.readdirSync(SESSION_RUNTIME_DIR)
            .filter((file) => file.endsWith('.json'))
            .map((file) => ({ file, session: readJson(path.join(SESSION_RUNTIME_DIR, file), null) }))
            .filter(({ file, session }) => {
                if (!session) return false;
                const expiresAt = session.expiresAt
                    ? new Date(session.expiresAt).getTime()
                    : new Date(session.createdAt).getTime() + 60 * 60000;
                if (Number.isFinite(expiresAt) && expiresAt <= now) {
                    fs.rmSync(path.join(SESSION_RUNTIME_DIR, file), { force: true });
                    return false;
                }
                session.expiresAt = new Date(expiresAt).toISOString();
                return true;
            })
            .map(({ session }) => session)
            .map((session) => ({
                ...session,
                embedUrl: session.mapUrl?.replace('/#', '/?embed=1#')
            }));
    } catch {
        return [];
    }
}

async function powershellJson(script) {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        cwd: ROOT, windowsHide: true, maxBuffer: 1024 * 1024
    });
    return stdout.trim() ? JSON.parse(stdout) : [];
}

async function taskState() {
    const result = await powershellJson(`@(Get-ScheduledTask | Where-Object { $_.TaskName -eq 'Serviceresor daily planner' -or $_.TaskName -like 'Fardtjanst-trip-*' } | ForEach-Object { $info = $_ | Get-ScheduledTaskInfo; [PSCustomObject]@{ name=$_.TaskName; state=$_.State.ToString(); nextRun=$info.NextRunTime; lastRun=$info.LastRunTime; lastResult=$info.LastTaskResult } }) | ConvertTo-Json -Depth 4`);
    return Array.isArray(result) ? result : [result];
}

async function processState() {
    const result = await powershellJson(`@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'tracking-service\.js|admin-server\.js' } | ForEach-Object { [PSCustomObject]@{ id=$_.ProcessId; command=$_.CommandLine; created=$_.CreationDate } }) | ConvertTo-Json -Depth 3`);
    return Array.isArray(result) ? result : [result];
}

// Reseuppgifterna är döpta Fardtjanst-trip-(check-)?<datum>-<användare>-<tid>.
// Datumet har fast bredd direkt efter prefixet, så ett användar-id med bindestreck
// kan inte förväxlas med en annan användares uppgifter. Endast avregistrering:
// en pågående körning får slutföras (Stop-ScheduledTask skulle döda wrappern
// och lämna en föräldralös node-process).
async function removeUserTasks(userId) {
    const pattern = `^Fardtjanst-trip-(check-)?\\d{4}-\\d{2}-\\d{2}-${userId}-\\d{3,4}$`;
    await powershellJson(`@(Get-ScheduledTask | Where-Object { $_.TaskName -cmatch '${pattern}' } | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue; $_.TaskName }) | ConvertTo-Json`);
}

// Dagens plan rensas också, annars står borttagna användare kvar som
// schemalagda resor i panelen fram till nästa planering.
function prunePlan(userId) {
    const file = path.join(ROOT, 'todays-trips.json');
    const plan = readJson(file, null);
    if (!plan || !Array.isArray(plan.users) || !plan.users.some((entry) => entry.userId === userId)) return;
    plan.users = plan.users.filter((entry) => entry.userId !== userId);
    fs.writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
}

// Fälten som går att redigera från panelen. ADMIN_DASHBOARD_PASSWORD står medvetet
// utanför: att byta lösenordet som skyddar sidan inifrån sidan vore att låsa sig ute.
const SETTING_FIELDS = [
    { name: 'HERENOW_API_KEY', label: 'here.now API-nyckel', secret: true, group: 'Kartpublicering' },
    { name: 'ELKS_API_USERNAME', label: '46elks användarnamn', secret: true, group: 'SMS via 46elks' },
    { name: 'ELKS_API_PASSWORD', label: '46elks lösenord', secret: true, group: 'SMS via 46elks' },
    { name: 'TEXTBEE_API_KEY', label: 'TextBee API-nyckel', secret: true, group: 'SMS via TextBee' },
    { name: 'TEXTBEE_DEVICE_ID', label: 'TextBee enhets-id', secret: false, group: 'SMS via TextBee' },
    { name: 'TEXTBEE_BASE_URL', label: 'TextBee bas-URL', secret: false, group: 'SMS via TextBee' },
    { name: 'NTFY_SERVER_URL', label: 'ntfy server', secret: false, group: 'ntfy' },
    { name: 'NTFY_ACCESS_TOKEN', label: 'ntfy åtkomsttoken', secret: true, group: 'ntfy' }
];
const SETTING_NAMES = new Set(SETTING_FIELDS.map((field) => field.name));

function readLocalEnv() {
    try {
        // trimStart tar bort BOM: setup-app.ps1 skriver filen som UTF8 med BOM.
        return JSON.parse(fs.readFileSync(LOCAL_ENV_FILE, 'utf8').trimStart());
    } catch {
        return {};
    }
}

// Skriv via tempfil och rename: panelen och spårningen kan läsa filen samtidigt,
// och en avbruten skrivning ska aldrig lämna halv JSON som gör miljön oläsbar.
function writeLocalEnv(values) {
    const temporary = `${LOCAL_ENV_FILE}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(values, null, 4)}\n`);
    fs.renameSync(temporary, LOCAL_ENV_FILE);
}

function maskSecret(value) {
    if (!value) return '';
    return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

function settingsState() {
    const file = readLocalEnv();
    return SETTING_FIELDS.map((field) => {
        const saved = file[field.name] || '';
        const active = process.env[field.name] || '';
        // local-env.js rör inte ett värde som redan finns i processmiljön. Skiljer sig
        // filen från det körande värdet vinner alltså en maskinnivåvariabel, och en
        // ändring i panelen får ingen effekt förrän den tas bort.
        const overridden = Boolean(saved) && Boolean(active) && saved !== active;
        return {
            name: field.name,
            label: field.label,
            group: field.group,
            secret: field.secret,
            configured: Boolean(active),
            overridden,
            value: field.secret ? undefined : saved,
            masked: field.secret ? maskSecret(saved) : undefined
        };
    });
}

function saveSettings(input) {
    const values = input && typeof input.values === 'object' && input.values ? input.values : {};
    const remove = Array.isArray(input?.remove) ? input.remove : [];
    if (!Object.keys(values).length && !remove.length) throw new Error('Inga inställningar skickades.');
    // Validera allt innan något skrivs: ett fel mitt i loopen ska inte lämna
    // filen halvskriven med några fält ändrade och resten orörda.
    for (const name of Object.keys(values)) {
        if (!SETTING_NAMES.has(name)) throw new Error(`Okänt fält: ${name}.`);
    }
    for (const name of remove) {
        if (!SETTING_NAMES.has(name)) throw new Error(`Okänt fält: ${name}.`);
    }
    const file = readLocalEnv();
    const changed = [];
    for (const [name, raw] of Object.entries(values)) {
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) continue;
        file[name] = value;
        process.env[name] = value;
        changed.push(name);
    }
    for (const name of remove) {
        delete file[name];
        delete process.env[name];
        changed.push(name);
    }
    if (!changed.length) throw new Error('Inga ändringar att spara.');
    writeLocalEnv(file);
    return changed;
}

// Samma uppslagning som tracking-service.js använder, så att "Stäng alla" fungerar
// även när nyckeln angetts i adminpanelen i stället för i credentials-filen.
function hereNowKey() {
    const fromEnvironment = process.env.HERENOW_API_KEY;
    if (fromEnvironment) return fromEnvironment;
    try {
        const key = fs.readFileSync(path.join(os.homedir(), '.herenow', 'credentials'), 'utf8').trim();
        if (key) return key;
    } catch {
        // Filen finns inte; felet nedan förklarar vad som ska göras.
    }
    throw new Error('here.now API-nyckel saknas. Ange den under API & nycklar.');
}

// Verifierar en kanal utan att skicka något till en mottagare. ntfy är undantaget:
// där finns ingen läsbar resurs att fråga, så ett test är en riktig notis.
async function testChannel(channel) {
    if (channel === 'herenow') {
        const key = hereNowKey();
        const response = await fetch('https://here.now/api/v1/publishes?limit=1', {
            headers: { Authorization: `Bearer ${key}` }
        });
        if (!response.ok) throw new Error(`here.now svarade ${response.status}.`);
        return 'here.now-nyckeln fungerar.';
    }
    if (channel === 'elks') {
        const username = process.env.ELKS_API_USERNAME;
        const password = process.env.ELKS_API_PASSWORD;
        if (!username || !password) throw new Error('46elks saknar användarnamn eller lösenord.');
        const response = await fetch('https://api.46elks.com/a1/me', {
            headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` }
        });
        if (!response.ok) throw new Error(`46elks svarade ${response.status}.`);
        return '46elks-uppgifterna fungerar.';
    }
    if (channel === 'textbee') {
        const key = process.env.TEXTBEE_API_KEY;
        if (!key) throw new Error('TextBee saknar API-nyckel.');
        const baseUrl = (process.env.TEXTBEE_BASE_URL || 'https://api.textbee.dev/api/v1').replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/gateway/devices`, { headers: { 'x-api-key': key } });
        if (!response.ok) throw new Error(`TextBee svarade ${response.status}.`);
        return 'TextBee-nyckeln fungerar.';
    }
    if (channel === 'ntfy') {
        const topic = readUsers().users.flatMap((user) => user.ntfyTopics || [])[0];
        if (!topic) throw new Error('Ingen ntfy-topic är konfigurerad för någon användare.');
        const server = (process.env.NTFY_SERVER_URL || 'https://ntfy.sh').replace(/\/$/, '');
        const headers = { Title: 'Serviceresor test', Priority: 'default', Tags: 'white_check_mark' };
        if (process.env.NTFY_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_ACCESS_TOKEN}`;
        const response = await fetch(`${server}/${encodeURIComponent(topic)}`, {
            method: 'POST',
            headers,
            body: `Testnotis från adminpanelen ${new Date().toLocaleString('sv-SE')}.`
        });
        if (!response.ok) throw new Error(`ntfy svarade ${response.status}.`);
        return `Testnotis skickad till ${topic}.`;
    }
    throw new Error(`Okänd kanal: ${channel}.`);
}

function canResolve(resolver) {
    try { resolver(); return true; } catch { return false; }
}

function environmentState() {
    const hereNowFile = path.join(os.homedir(), '.herenow', 'credentials');
    return {
        hereNow: Boolean(process.env.HERENOW_API_KEY || fs.existsSync(hereNowFile)),
        // publish.sh och Git Bash hittas automatiskt i local-env.js, så statusen är
        // "går den att hitta" i stället för "är variabeln satt".
        publisher: canResolve(resolvePublishScript),
        gitBash: canResolve(resolveGitBash),
        sms: Boolean(process.env.ELKS_API_USERNAME && process.env.ELKS_API_PASSWORD),
        textbee: Boolean(process.env.TEXTBEE_API_KEY),
        textbeeBaseUrl: process.env.TEXTBEE_BASE_URL || 'https://api.textbee.dev/api/v1',
        ntfyServer: process.env.NTFY_SERVER_URL || 'https://ntfy.sh',
        ntfyToken: Boolean(process.env.NTFY_ACCESS_TOKEN),
        settings: settingsState()
    };
}

async function overview() {
    const [tasks, processes] = await Promise.all([taskState(), processState()]);
    const plan = readJson(path.join(ROOT, 'todays-trips.json'), { date: null, users: [] });
    return {
        generatedAt: new Date().toISOString(),
        users: maskedUsers(),
        plan,
        planStatus: plan.date === localDateKey() ? 'current' : 'stale',
        localDate: localDateKey(),
        tasks,
        processes,
        sessions: activeSessions(),
        environment: environmentState(),
        logs: {
            planner: tail(path.join(ROOT, 'daily-trips.log')),
            errors: tail(path.join(ROOT, 'daily-trips-error.log')),
            morning: tail(path.join(ROOT, 'trip-0725.log'), 30),
            afternoon: tail(path.join(ROOT, 'trip-1610.log'), 30)
        }
    };
}

function launchPlanner() {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'run-daily-trips.ps1')], {
        cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore'
    });
    child.unref();
}

async function stopSessions() {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-ScheduledTask -TaskName 'Fardtjanst-trip-*' -ErrorAction SilentlyContinue | ForEach-Object { Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'tracking-service\.js.*track' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { cwd: ROOT, windowsHide: true });
    const key = hereNowKey();
    for (const session of activeSessions()) {
        await fetch(`https://here.now/api/v1/publish/${session.slug}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${key}` }
        }).catch(() => {});
        fs.rmSync(path.join(SESSION_RUNTIME_DIR, `${session.slug}.json`), { force: true });
    }
}

function serveFile(response, pathname) {
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(PUBLIC_DIR, requested);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404);
        response.end('Not found');
        return;
    }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
    fs.createReadStream(file).pipe(response);
}

const server = http.createServer(async (request, response) => {
    if (!requireAuth(request, response)) return;
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    try {
        if (url.pathname === '/api/overview' && request.method === 'GET') return sendJson(response, 200, await overview());
        if (url.pathname === '/api/users' && request.method === 'GET') return sendJson(response, 200, { users: maskedUsers() });
        if (url.pathname === '/api/settings' && request.method === 'GET') return sendJson(response, 200, { settings: settingsState() });
        if (url.pathname === '/api/users' && request.method === 'PUT') {
            if (!requireAction(request, response)) return;
            const body = await readBody(request);
            const current = readUsers();
            const existing = current.users.find((user) => user.id === body.id);
            const next = validateUser(body, existing);
            const users = existing ? current.users.map((user) => user.id === next.id ? next : user) : [...current.users, next];
            fs.writeFileSync(USERS_FILE, `${JSON.stringify({ users }, null, 4)}\n`);
            return sendJson(response, 200, { users: maskedUsers() });
        }
        if (url.pathname === '/api/users' && request.method === 'DELETE') {
            if (!requireAction(request, response)) return;
            const body = await readBody(request);
            const id = typeof body.id === 'string' ? body.id.trim() : '';
            if (!/^[a-z0-9_-]{1,40}$/i.test(id)) return sendJson(response, 400, { error: 'Användar-id är ogiltigt.' });
            const current = readUsers();
            if (!current.users.some((user) => user.id === id)) return sendJson(response, 404, { error: 'Användaren finns inte.' });
            fs.writeFileSync(USERS_FILE, `${JSON.stringify({ users: current.users.filter((user) => user.id !== id) }, null, 4)}\n`);
            // Städningen är bäst-efforts: användaren är redan borta, och ett fel här
            // ska inte rapportera borttagningen som misslyckad.
            try {
                await removeUserTasks(id);
                prunePlan(id);
            } catch (error) {
                console.error(`Kunde inte städa efter borttagen användare ${id}:`, error);
            }
            return sendJson(response, 200, { users: maskedUsers() });
        }
        if (url.pathname === '/api/settings' && request.method === 'PUT') {
            if (!requireAction(request, response)) return;
            const changed = saveSettings(await readBody(request));
            return sendJson(response, 200, { changed, settings: settingsState() });
        }
        if (url.pathname === '/api/settings/test' && request.method === 'POST') {
            if (!requireAction(request, response)) return;
            const body = await readBody(request);
            return sendJson(response, 200, { message: await testChannel(body.channel) });
        }
        if (url.pathname === '/api/actions/run-planner' && request.method === 'POST') {
            if (!requireAction(request, response)) return;
            launchPlanner();
            return sendJson(response, 202, { started: true });
        }
        if (url.pathname === '/api/actions/stop-sessions' && request.method === 'POST') {
            if (!requireAction(request, response)) return;
            await stopSessions();
            return sendJson(response, 200, { stopped: true });
        }
        if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Unknown API route.' });
        serveFile(response, url.pathname);
    } catch (error) {
        console.error(error);
        sendJson(response, 500, { error: error.message });
    }
});

server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} is already in use - the admin dashboard is probably already running.`);
        process.exit(0);
    }
    console.error(error);
    process.exit(1);
});

server.listen(PORT, HOST, () => console.log(`Serviceresor admin dashboard: http://${HOST}:${PORT}`));
