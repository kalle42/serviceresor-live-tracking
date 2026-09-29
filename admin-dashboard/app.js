const state = { overview: null, selectedLog: 'planner' };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[character]));
const list = (value) => Array.isArray(value) ? value : value ? [value] : [];

function formatDate(value) {
    if (!value) return '–';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('sv-SE', { dateStyle:'short', timeStyle:'short' });
}

function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('visible'), 3200);
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type':'application/json', ...(options.action ? { 'X-Admin-Action':'true' } : {}), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
}

function renderTrips(plan) {
    const trips = list(plan?.users).flatMap((user) => list(user.trips).map((trip) => ({ ...trip, userId:user.userId })));
    $('#trip-count').textContent = trips.length;
    $('#plan-date').textContent = plan?.date || 'Ingen plan';
    $('#trip-list').className = trips.length ? 'trip-list' : 'trip-list empty-state';
    $('#trip-list').innerHTML = trips.length ? trips.map((trip) => `
        <article class="trip-card">
            <strong class="trip-time">${escapeHtml(trip.time)}</strong>
            <div><strong>${escapeHtml(trip.userId)}</strong><p>${escapeHtml(trip.url.split('/').pop())}</p></div>
            <span class="badge">Schemalagd</span>
        </article>`).join('') : 'Ingen planeringsdata ännu.';
}

function renderSessions(sessions) {
    $('#session-count').textContent = sessions.length;
    $('#session-signal').className = sessions.length ? 'signal warn' : 'signal';
    $('#session-list').className = sessions.length ? 'stack-list' : 'stack-list empty-state';
    $('#session-list').innerHTML = sessions.length ? sessions.map((session) => `
        <div class="list-row"><strong>${escapeHtml(session.userId)} · ${escapeHtml(session.tripTime)}</strong><p>${escapeHtml(session.slug)}</p><p>Startad ${formatDate(session.createdAt)}</p></div>`).join('') : 'Inga aktiva kartor.';
    $('#gallery-list').className = sessions.length ? 'map-gallery' : 'map-gallery empty-state';
    $('#gallery-list').innerHTML = sessions.length ? sessions.map((session) => `
        <article class="map-card">
            <div class="map-card-heading"><div><span class="map-live-dot"></span><strong>${escapeHtml(session.userId)}</strong><span>${escapeHtml(session.tripTime)}</span></div><a href="${escapeHtml(session.mapUrl)}" target="_blank" rel="noreferrer">Öppna</a></div>
            <iframe src="${escapeHtml(session.mapUrl)}" title="Livekarta för ${escapeHtml(session.userId)}" loading="lazy" referrerpolicy="no-referrer"></iframe>
            <p>Session startad ${formatDate(session.createdAt)}</p>
        </article>`).join('') : 'Inga pågående resor.';
}

function renderUsers(users) {
    $('#user-list').innerHTML = users.map((user) => `
        <article class="user-card">
            <div><h3>${escapeHtml(user.id)}</h3><p>${escapeHtml(user.ssnMasked)} · ${user.hasPassword ? 'Lösenord sparat' : 'Lösenord saknas'}</p>
                <div class="channel-list"><span class="channel">SMS ${list(user.smsTo).length}</span><span class="channel">TextBee ${list(user.textbeeTo).length}</span><span class="channel">ntfy ${list(user.ntfyTopics).length}</span></div>
            </div>
            <button class="text-button edit-user" data-user="${escapeHtml(user.id)}">Redigera</button>
        </article>`).join('');
    document.querySelectorAll('.edit-user').forEach((button) => button.addEventListener('click', () => openUserForm(users.find((user) => user.id === button.dataset.user))));
}

function renderTasks(tasks) {
    $('#task-list').innerHTML = tasks.length ? tasks.map((task) => `
        <tr><td>${escapeHtml(task.name)}</td><td>${escapeHtml(task.state)}</td><td>${formatDate(task.nextRun)}</td><td>${escapeHtml(task.lastResult)}</td></tr>`).join('') : '<tr><td colspan="4">Inga uppgifter hittades.</td></tr>';
    const planner = tasks.find((task) => task.name === 'Serviceresor daily planner');
    $('#planner-status').textContent = planner ? planner.state : 'Saknas';
    $('#planner-signal').className = planner ? 'signal' : 'signal bad';
}

function renderEnvironment(environment) {
    const entries = [
        ['here.now', environment.hereNow], ['Publisher', environment.publisher], ['Git Bash', environment.gitBash],
        ['46elks', environment.sms], ['ntfy token', environment.ntfyToken], ['ntfy server', environment.ntfyServer]
    ];
    $('#environment-list').innerHTML = entries.map(([label, value]) => {
        const boolean = typeof value === 'boolean';
        return `<div class="environment-item"><span>${escapeHtml(label)}</span><strong class="${boolean ? (value ? 'ok' : 'missing') : 'ok'}">${escapeHtml(boolean ? (value ? 'Klar' : 'Saknas') : value)}</strong></div>`;
    }).join('');
}

function renderLogs(logs) {
    const lines = list(logs[state.selectedLog]);
    $('#log-output').textContent = lines.length ? lines.join('\n') : 'Ingen loggdata.';
    $('#error-count').textContent = list(logs.errors).length;
    $('#error-signal').className = list(logs.errors).length ? 'signal bad' : 'signal';
}

function render(data) {
    state.overview = data;
    renderTrips(data.plan);
    renderSessions(data.sessions || []);
    renderUsers(data.users || []);
    renderTasks(data.tasks || []);
    renderEnvironment(data.environment || {});
    renderLogs(data.logs || {});
    $('#plan-date').classList.toggle('stale', data.planStatus === 'stale');
    $('#plan-date').title = data.planStatus === 'stale' ? `Planen är från ${data.plan?.date || 'okänt datum'}. Lokal dag är ${data.localDate}.` : 'Aktuell plan';
    $('#updated-at').textContent = new Date(data.generatedAt).toLocaleTimeString('sv-SE');
}

async function refresh(silent = false) {
    try {
        render(await api('/api/overview'));
        if (!silent) toast('Dashboard uppdaterad');
    } catch (error) {
        $('#planner-status').textContent = 'Kunde inte läsa';
        toast(error.message);
    }
}

function openUserForm(user = null) {
    $('#user-form').classList.remove('hidden');
    $('#form-title').textContent = user ? `Redigera ${user.id}` : 'Ny användare';
    $('#user-id').value = user?.id || '';
    $('#user-id').readOnly = Boolean(user);
    $('#user-ssn').value = '';
    $('#user-password').value = '';
    $('#user-sms').value = list(user?.smsTo).join('\n');
    $('#user-textbee').value = list(user?.textbeeTo).join('\n');
    $('#user-ntfy').value = list(user?.ntfyTopics).join('\n');
    $('#user-form').scrollIntoView({ behavior:'smooth', block:'center' });
}

$('#user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
        id: $('#user-id').value.trim(), ssn: $('#user-ssn').value.trim(), password: $('#user-password').value,
        smsTo: $('#user-sms').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        textbeeTo: $('#user-textbee').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        ntfyTopics: $('#user-ntfy').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    };
    try {
        await api('/api/users', { method:'PUT', body:JSON.stringify(payload), action:true });
        $('#user-form').classList.add('hidden');
        await refresh(true);
        toast('Användaren sparades');
    } catch (error) { toast(error.message); }
});

$('#refresh-button').addEventListener('click', () => refresh());
$('#planner-button').addEventListener('click', async () => {
    try { await api('/api/actions/run-planner', { method:'POST', action:true }); toast('Planeringen startades'); setTimeout(() => refresh(true), 4000); } catch (error) { toast(error.message); }
});
$('#stop-button').addEventListener('click', async () => {
    if (!confirm('Stäng alla kartor, trackers och reseuppgifter?')) return;
    try { await api('/api/actions/stop-sessions', { method:'POST', action:true }); await refresh(true); toast('Alla sessioner stängdes'); } catch (error) { toast(error.message); }
});
$('#new-user-button').addEventListener('click', () => openUserForm());
$('#close-form').addEventListener('click', () => $('#user-form').classList.add('hidden'));
$('#log-selector').addEventListener('change', (event) => { state.selectedLog = event.target.value; renderLogs(state.overview.logs); });
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('sv-SE'); }, 1000);
setInterval(() => refresh(true), 30000);
refresh(true);
