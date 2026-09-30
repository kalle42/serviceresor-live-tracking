const map = L.map('map').setView([57.688, 11.923], 13);
if (new URLSearchParams(location.search).get('embed') === '1') document.body.classList.add('embed');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);

const vehicleIcon = L.divIcon({
    className: '',
    html: '<div class="vehicle-marker" aria-label="Fordon">🚗</div>',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
});
let vehicleMarker;
let pickupMarker;
let dropoffMarker;
let lastRecordedAt;

map.on('zoomend', () => {
    if (vehicleMarker) map.panTo(vehicleMarker.getLatLng(), { animate: false });
});

function decodeBase64Url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function decryptRecord(record) {
    const keyValue = location.hash.slice(1);
    if (!keyValue) throw new Error('Länknyckeln saknas.');
    const key = await crypto.subtle.importKey('raw', decodeBase64Url(keyValue), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64Url(record.iv) },
        key,
        decodeBase64Url(record.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}

async function update() {
    try {
        const response = await fetch('./.herenow/data/positions?limit=1', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Positionstjänsten svarade ${response.status}`);
        const { records } = await response.json();
        if (!records[0]) return;
        const data = await decryptRecord(records[0].data);
        document.querySelector('#traveller').textContent = data.first_name || 'Ej angiven';
        document.querySelector('#vehicle').textContent = data.vehicle_number || 'Ej tilldelat';
        document.querySelector('#pickup').textContent = data.pickup_address || 'Ej angiven';
        document.querySelector('#dropoff').textContent = data.dropoff_address || 'Ej angiven';
        if (data.recorded_at === lastRecordedAt) return;

        const vehicle = [data.latitude, data.longitude];
        const pickup = [data.pickup_latitude, data.pickup_longitude];
        const dropoff = [data.dropoff_latitude, data.dropoff_longitude];
        const hasVehicle = vehicle.every(Number.isFinite) && !vehicle.includes(0);
        const hasRoute = [...pickup, ...dropoff].every(Number.isFinite);
        const firstVehiclePosition = hasVehicle && !vehicleMarker;
        const dotStyle = { radius:8, color:'#fff', weight:3, fillColor:'#1769e0', fillOpacity:1 };
        if (hasRoute && !pickupMarker) {
            pickupMarker = L.circleMarker(pickup, dotStyle).addTo(map);
            dropoffMarker = L.circleMarker(dropoff, dotStyle).addTo(map);
        }
        if (hasVehicle && !vehicleMarker) vehicleMarker = L.marker(vehicle, { icon: vehicleIcon }).addTo(map);
        else if (hasVehicle) vehicleMarker.setLatLng(vehicle);
        if (hasVehicle) map.setView(vehicle, firstVehiclePosition ? 16 : map.getZoom(), { animate:false });
        else if (hasRoute) map.fitBounds([pickup, dropoff], { paddingTopLeft:[24,190], paddingBottomRight:[24,60], maxZoom:16 });
        document.querySelector('#status-title').textContent = hasVehicle ? 'Fordonet är på väg' : 'Resans sträcka';
        document.querySelector('#status-detail').textContent = hasVehicle ? 'Kartan uppdateras automatiskt.' : 'Väntar på fordonets GPS-position.';
        document.querySelector('#updated').textContent = `Uppdaterad ${new Date(data.recorded_at).toLocaleTimeString('sv-SE')}`;
        lastRecordedAt = data.recorded_at;
    } catch (error) {
        document.querySelector('#status-title').textContent = 'Länken kan inte öppnas';
        document.querySelector('#status-detail').textContent = error.message;
    }
}
update();
setInterval(update, 10000);
