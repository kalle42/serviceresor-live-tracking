const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'admin-dashboard');
const USERS_FILE = path.join(ROOT, 'users.local.json');
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
        ssnMasked: user.ssn ? `${user.ssn.slice(0, 4)}••••-••••` : 'Not set',
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

function tail(file, count = 60) {
    try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-count); } catch { return []; }
}

function activeSessions() {
    try {
        return fs.readdirSync(SESSION_RUNTIME_DIR)
            .filter((file) => file.endsWith('.json'))
            .map((file) => readJson(path.join(SESSION_RUNTIME_DIR, file), null))
            .filter(Boolean);
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
    const result = await powershellJson(`@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'daily-trips\.js|admin-server\.js' } | ForEach-Object { [PSCustomObject]@{ id=$_.ProcessId; command=$_.CommandLine; created=$_.CreationDate } }) | ConvertTo-Json -Depth 3`);
    return Array.isArray(result) ? result : [result];
}

function environmentState() {
    const hereNowFile = path.join(os.homedir(), '.herenow', 'credentials');
    return {
        hereNow: Boolean(process.env.HERENOW_API_KEY || fs.existsSync(hereNowFile)),
        publisher: Boolean(process.env.HERENOW_PUBLISH_SCRIPT),
        gitBash: Boolean(process.env.GIT_BASH_PATH),
        sms: Boolean(process.env.ELKS_API_USERNAME && process.env.ELKS_API_PASSWORD),
        textbee: Boolean(process.env.TEXTBEE_API_KEY),
        textbeeBaseUrl: process.env.TEXTBEE_BASE_URL || 'https://api.textbee.dev/api/v1',
        ntfyServer: process.env.NTFY_SERVER_URL || 'https://ntfy.sh',
        ntfyToken: Boolean(process.env.NTFY_ACCESS_TOKEN)
    };
}

async function overview() {
    const [tasks, processes] = await Promise.all([taskState(), processState()]);
    const plan = readJson(path.join(ROOT, 'todays-trips.json'), { date: null, users: [] });
    return {
        generatedAt: new Date().toISOString(),
        users: maskedUsers(),
        plan,
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
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-ScheduledTask -TaskName 'Fardtjanst-trip-*' -ErrorAction SilentlyContinue | ForEach-Object { Stop-ScheduledTask -TaskName $_.TaskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'daily-trips\.js.*track' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { cwd: ROOT, windowsHide: true });
    const key = process.env.HERENOW_API_KEY || fs.readFileSync(path.join(os.homedir(), '.herenow', 'credentials'), 'utf8').trim();
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

server.listen(PORT, HOST, () => console.log(`Serviceresor admin dashboard: http://${HOST}:${PORT}`));
