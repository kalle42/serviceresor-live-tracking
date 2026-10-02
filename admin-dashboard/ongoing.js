const gallery = document.querySelector('#ongoing-gallery');
const count = document.querySelector('#ongoing-count');
const lastUpdate = document.querySelector('#last-update');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[character]));
const fallback = (value, text = 'Ej tillgängligt') => value || text;

function formatTime(value) {
    if (!value) return '–';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString('sv-SE', { hour:'2-digit', minute:'2-digit' });
}

function toast(message) {
    const element = document.querySelector('#toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('visible'), 2800);
}

function render(sessions) {
    count.textContent = sessions.length;
    gallery.className = sessions.length ? 'ongoing-gallery' : 'ongoing-gallery';
    gallery.innerHTML = sessions.length ? sessions.map((session) => `
        <article class="trip-map-card">
            <div class="map-frame">
                <span class="live-label">Live</span>
                <iframe src="${escapeHtml(session.embedUrl || session.mapUrl)}" title="Livekarta för ${escapeHtml(session.firstName || session.userId)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>
            </div>
            <div class="trip-info">
                <div class="trip-title"><h2>${escapeHtml(fallback(session.firstName, session.userId))}</h2><strong>${escapeHtml(session.tripTime)}</strong></div>
                <div class="info-grid">
                    <div><span>Fordon</span><p>${escapeHtml(fallback(session.vehicleNumber, 'Ej tilldelat'))}</p></div>
                    <div><span>Startad</span><p>${escapeHtml(formatTime(session.createdAt))}</p></div>
                    <div class="route-info"><span>Från</span><p>${escapeHtml(fallback(session.pickupAddress))}</p></div>
                    <div class="route-info"><span>Till</span><p>${escapeHtml(fallback(session.dropoffAddress))}</p></div>
                </div>
                <div class="trip-footer"><time>Stängs ${escapeHtml(formatTime(session.expiresAt))}</time><a href="${escapeHtml(session.mapUrl)}" target="_blank" rel="noreferrer">Öppna stor karta</a></div>
            </div>
        </article>`).join('') : '<div class="empty-state">Inga pågående resor just nu.</div>';
}

async function refresh(showToast = false) {
    try {
        const response = await fetch('/api/overview', { credentials:'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        render(data.sessions || []);
        lastUpdate.textContent = `Uppdaterad ${new Date(data.generatedAt).toLocaleTimeString('sv-SE')}`;
        if (showToast) toast('Galleriet uppdaterades');
    } catch (error) {
        gallery.innerHTML = `<div class="empty-state">Kunde inte läsa pågående resor: ${escapeHtml(error.message)}</div>`;
    }
}

document.querySelector('#refresh-button').addEventListener('click', () => refresh(true));
setInterval(() => refresh(false), 10000);
refresh(false);
