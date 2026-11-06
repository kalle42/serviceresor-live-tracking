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
        <div class="list-row"><strong>${escapeHtml(session.userId)} · ${escapeHtml(session.tripTime)}</strong><p>${escapeHtml(session.slug)}</p><p>Startad ${formatDate(session.createdAt)} · stängs ${formatDate(session.expiresAt)}</p></div>`).join('') : 'Inga aktiva kartor.';
}

function renderActiveTrips(sessions) {
    const listElement = $('#active-trip-list');
    listElement.className = sessions.length ? 'active-trip-list' : 'active-trip-list empty-state';
    listElement.innerHTML = sessions.length ? sessions.map((session) => `
        <article class="active-trip-row">
            <div class="active-trip-main"><span class="map-live-dot"></span><strong>${escapeHtml(session.firstName || session.userId)}</strong><span>${escapeHtml(session.tripTime)}</span></div>
            <div><span>Fordon</span><strong>${escapeHtml(session.vehicleNumber || 'Ej tilldelat')}</strong></div>
            <div class="active-trip-route"><span>Från</span><p>${escapeHtml(session.pickupAddress || 'Ej angiven')}</p></div>
            <div class="active-trip-route"><span>Till</span><p>${escapeHtml(session.dropoffAddress || 'Ej angiven')}</p></div>
            <div class="active-trip-expiry"><span>Stängs</span><strong>${escapeHtml(formatDate(session.expiresAt))}</strong></div>
        </article>`).join('') : 'Inga aktiva resor just nu.';
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

const SETTINGS_TESTS = [['Kartpublicering', 'herenow'], ['SMS via 46elks', 'elks'], ['SMS via TextBee', 'textbee'], ['ntfy', 'ntfy']];

function renderSettings(settings) {
    state.settings = settings;
    const groups = [...new Set(settings.map((field) => field.group))];
    $('#settings-list').innerHTML = groups.map((group) => {
        const channel = SETTINGS_TESTS.find(([name]) => name === group)?.[1];
        const rows = settings.filter((field) => field.group === group).map((field) => {
            // Ett sparat värde visas bara som mask. Fältet är tomt tills det fylls i,
            // och tomt betyder "behåll" — samma regel som användarformuläret.
            const placeholder = field.configured
                ? (field.secret ? `${field.masked || '••••'} (sparat)` : String(field.value || ''))
                : 'Inte konfigurerat';
            const status = field.overridden
                ? '<span class="settings-state warn">Överskuggad</span>'
                : field.configured ? '<span class="settings-state ok">Klar</span>' : '<span class="settings-state missing">Saknas</span>';
            return `
                <div class="settings-row">
                    <label for="setting-${field.name}">${escapeHtml(field.label)}</label>
                    <input id="setting-${field.name}" data-setting="${escapeHtml(field.name)}" autocomplete="off"
                        ${field.secret ? 'type="password"' : 'type="text"'} placeholder="${escapeHtml(placeholder)}">
                    <div class="settings-actions">${status}${field.configured ? `<button class="settings-test" data-clear="${escapeHtml(field.name)}">Rensa</button>` : ''}</div>
                    ${field.overridden ? '<p class="settings-override">En miljövariabel på maskinnivå har ett annat värde och vinner över filen. Ta bort den för att panelens värde ska gälla.</p>' : ''}
                </div>`;
        }).join('');
        return `<div class="settings-group"><h3>${escapeHtml(group)}${channel ? ` <button class="settings-test" data-channel="${channel}">Testa</button>` : ''}</h3>${rows}</div>`;
    }).join('');

    document.querySelectorAll('.settings-test[data-channel]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try { toast((await api('/api/settings/test', { method:'POST', action:true, body:JSON.stringify({ channel:button.dataset.channel }) })).message); }
        catch (error) { toast(error.message); }
        finally { button.disabled = false; }
    }));

    // Rensa skickar ett tomt värde, vilket servern tolkar som "ta bort nyckeln".
    document.querySelectorAll('.settings-test[data-clear]').forEach((button) => button.addEventListener('click', async () => {
        const field = settings.find((item) => item.name === button.dataset.clear);
        if (!confirm(`Ta bort ${field?.label || button.dataset.clear}?`)) return;
        try {
            const result = await api('/api/settings', { method:'PUT', body:JSON.stringify({ remove:[button.dataset.clear] }), action:true });
            renderSettings(result.settings);
            toast('Inställningen togs bort');
        } catch (error) { toast(error.message); }
    }));
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
    renderActiveTrips(data.sessions || []);
    renderUsers(data.users || []);
    renderTasks(data.tasks || []);
    renderSettings(data.environment?.settings || []);
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
$('#settings-save').addEventListener('click', async () => {
    const values = {};
    // Tomma fält skickas inte alls: "orörd" och "rensa" måste gå att skilja åt.
    document.querySelectorAll('[data-setting]').forEach((input) => {
        if (input.value.trim()) values[input.dataset.setting] = input.value.trim();
    });
    if (!Object.keys(values).length) { toast('Inget att spara'); return; }
    try {
        const result = await api('/api/settings', { method:'PUT', body:JSON.stringify({ values }), action:true });
        document.querySelectorAll('[data-setting]').forEach((input) => { input.value = ''; });
        renderSettings(result.settings);
        toast(`${result.changed.length} inställning(ar) sparade`);
    } catch (error) { toast(error.message); }
});
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
