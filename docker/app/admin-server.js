const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadLocalEnvironment, resolvePublishScript, resolveGitBash } = require('./local-env');
loadLocalEnvironment(__dirname);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'admin-dashboard');
const USERS_FILE = path.join(ROOT, 'users.local.json');
const LOCAL_ENV_FILE = path.join(ROOT, '.env.local.json');
const SESSION_RUNTIME_DIR = path.join(ROOT, 'session-runtime');
// Docker-versionen: scheduler.js ersätter Windows Task Scheduler och skriver sitt
// läge hit. Kommandofilen är köpanelens sätt att be schemaläggaren göra något.
const SCHEDULER_STATE_FILE = path.join(ROOT, 'scheduler-state.json');
const SCHEDULER_COMMAND_FILE = path.join(ROOT, 'scheduler-command.json');
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
        ssnMasked: user.ssn ? `${user.ssn.slice(0, 4)}****-****` : 'Not set',
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
    const ssn = input.ssn || existing?.ssn;
    const password = input.password || existing?.password;
    if (!ssn || !password) throw new Error('Serviceresor credentials are required.');
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

// Docker-versionen: läst läge från scheduler.js i stället för Windows Task
// Scheduler och WMI. Uppgifterna behåller samma fält som Get-ScheduledTaskInfo
// gav: name, state, nextRun, lastRun, lastResult.
async function taskState() {
    return readJson(SCHEDULER_STATE_FILE, { tasks: [] }).tasks || [];
}

async function processState() {
    return readJson(SCHEDULER_STATE_FILE, { processes: [] }).processes || [];
}

function writeSchedulerCommand(command) {
    const temporary = `${SCHEDULER_COMMAND_FILE}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(command, null, 2)}\n`);
    fs.renameSync(temporary, SCHEDULER_COMMAND_FILE);
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
// realpath pekar ut den riktiga filen: i Docker är .env.local.json en symbolisk
// länk till /app/data, och rename får inte ersätta länken med en vanlig fil.
function writeLocalEnv(values) {
    let target = LOCAL_ENV_FILE;
    try { target = fs.realpathSync(LOCAL_ENV_FILE); } catch {}
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(values, null, 4)}\n`);
    fs.renameSync(temporary, target);
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
    // Körplaneraren körs av scheduler.js, precis som run-daily-trips.ps1 gjorde:
    // planera dagen och registrera resejobben.
    writeSchedulerCommand({ command: 'run-planner', requestedAt: new Date().toISOString() });
}

async function stopSessions() {
    writeSchedulerCommand({ command: 'stop-sessions', requestedAt: new Date().toISOString() });
    // Vänta in att spårningsprocesserna avslutas innan kartorna stängs, annars
    // hinner en pågående spårning skriva en ny session efter städningen.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const running = (await processState()).filter((process) => process.kind === 'track');
        if (running.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
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
