// --- 全域變數 ---
let map;
let routeLine = null;
let totalDistance = 0;
let currentDistance = 0;
let isPlaying = false;
let animationId = null;
let lastTime = 0;
let playbackSpeed = 1;
let photoFeatures = [];
let shownPhotos = new Set();
let noGpsPhotos = [];
let activePopup = null;
let photoCardTimeout = null;
let photoDateRange = { min: null, max: null };
let photoDisplayPoints = []; // 用於截圖
let finalPopups = []; 

// --- DOM 元件 ---
const uploadInput = document.getElementById('photo-upload');
const photoCard = document.getElementById('photo-card');
const photoCardImg = document.getElementById('photo-card-img');
const photoCardLabel = document.getElementById('photo-card-label');
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const routeTitle = document.getElementById('route-title');

// --- 1. 初始化地圖 ---
initMap();

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        attributionControl: false,
        preserveDrawingBuffer: true,
        style: {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            sources: {
                'satellite': {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    crossOrigin: 'anonymous'
                },
                'terrain-source': {
                    type: 'raster-dem',
                    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                    encoding: 'terrarium',
                    tileSize: 256
                }
            },
            layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite', paint: { 'raster-saturation': 0.2 } }],
            terrain: { source: 'terrain-source', exaggeration: 1.5 }
        },
        center: [120.9738, 23.9756],
        zoom: 6,
        pitch: 0
    });

    map.on('load', setupLayers);
}

function setupLayers() {
    // 預覽虛線
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'route-preview', type: 'line', source: 'route', paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [2, 2] } });

    // 進度藍線
    map.addSource('route-progress', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'route-progress', type: 'line', source: 'route-progress', paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-cap': 'round' } });

    // 小藍點
    map.addSource('point', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [] } } });
    map.addLayer({ id: 'point-circle', type: 'circle', source: 'point', paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#3b82f6' } });

    // 照片點與叢集
    map.addSource('photos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 });
    map.addLayer({ id: 'photo-clusters', type: 'circle', source: 'photos', filter: ['has', 'point_count'], paint: { 'circle-color': '#3b82f6', 'circle-radius': 20, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    map.addLayer({ id: 'photo-cluster-count', type: 'symbol', source: 'photos', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 }, paint: { 'text-color': '#fff' } });
    map.addLayer({ id: 'photo-markers', type: 'circle', source: 'photos', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 8, 'circle-color': '#bfdbfe', 'circle-stroke-width': 2, 'circle-stroke-color': '#60a5fa' } });
}

// --- 2. 照片處理與 EXIF ---
if (uploadInput) {
    uploadInput.addEventListener('change', handleUpload);
}

async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const metadata = await Promise.all(files.map(file => {
        return new Promise(resolve => {
            EXIF.getData(file, function() {
                const lat = EXIF.getTag(this, 'GPSLatitude');
                const lon = EXIF.getTag(this, 'GPSLongitude');
                const alt = EXIF.getTag(this, 'GPSAltitude');
                const altRef = EXIF.getTag(this, 'GPSAltitudeRef');
                const date = EXIF.getTag(this, 'DateTimeOriginal');

                // 修正經緯度轉換
                const toDec = (dms, ref) => {
                    if (!dms) return null;
                    let dec = dms[0] + dms[1] / 60 + dms[2] / 3600;
                    return (ref === 'S' || ref === 'W') ? -dec : dec;
                };

                // 修正海拔轉換 (處理分數物件)
                let altitude = 0;
                if (alt !== undefined) {
                    altitude = typeof alt === 'object' ? (alt.numerator / alt.denominator) : parseFloat(alt);
                    if (altRef === 1) altitude = -altitude;
                }

                resolve({
                    coords: lat && lon ? [toDec(lon, EXIF.getTag(this, 'GPSLongitudeRef')), toDec(lat, EXIF.getTag(this, 'GPSLatitudeRef'))] : null,
                    altitude: altitude,
                    time: date ? date.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1/$2/$3') : null,
                    file
                });
            });
        });
    }));

    // 清理舊資料避免記憶體洩漏
    photoFeatures.forEach(f => URL.revokeObjectURL(f.properties.objectUrl));
    finalPopups.forEach(p => p.remove());
    finalPopups = [];
    photoFeatures = [];
    shownPhotos.clear();

    metadata.forEach((m, i) => {
        if (!m.coords) return;
        photoFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: m.coords },
            properties: {
                id: `photo-${i}`,
                altitude: m.altitude,
                time: m.time,
                objectUrl: URL.createObjectURL(m.file)
            }
        });
    });

    photoFeatures.sort((a, b) => new Date(a.properties.time) - new Date(b.properties.time));
    map.getSource('photos').setData({ type: 'FeatureCollection', features: photoFeatures });

    const coords = photoFeatures.map(f => f.geometry.coordinates);
    if (coords.length >= 2) await updateRoute(coords);
}

// --- 3. 路徑規劃 ---
async function updateRoute(coords) {
    const pointsStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    try {
        const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${pointsStr}?overview=full&geometries=geojson`);
        const data = await resp.json();
        if (data.code !== 'Ok') throw new Error();
        routeLine = data.routes[0].geometry;
    } catch {
        routeLine = turf.lineString(coords).geometry;
    }

    totalDistance = turf.length(routeLine, { units: 'kilometers' });
    currentDistance = 0;
    map.getSource('route').setData(routeLine);
    
    const bbox = turf.bbox(routeLine);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: { left: 400, right: 50, top: 50, bottom: 50 } });
}

// --- 4. 核心顯示與海拔模擬 (唯一版本) ---
function updateDisplay(dist) {
    if (!routeLine) return;
    const point = turf.along(routeLine, dist, { units: 'kilometers' });
    const coords = point.geometry.coordinates;

    // 更新地圖點
    const prog = turf.lineSlice(turf.point(routeLine.coordinates[0]), point, routeLine);
    map.getSource('route-progress').setData(prog);
    map.getSource('point').setData(point);
    distanceDisplay.innerText = dist.toFixed(2);

    // 海拔模擬：找最近照片
    let closest = null, minD = Infinity;
    photoFeatures.forEach(f => {
        const d = turf.distance(point, f, { units: 'kilometers' });
        if (d < minD) { minD = d; closest = f; }
    });

    const baseAlt = closest ? closest.properties.altitude : 0;
    const terrainNow = map.queryTerrainElevation(coords);
    const terrainBase = closest ? map.queryTerrainElevation(closest.geometry.coordinates) : null;

    let displayAlt = baseAlt;
    // 數據有效才做加減模擬
    if (terrainNow > -50 && terrainBase > -50) {
        displayAlt = baseAlt + (terrainNow - terrainBase);
    }
    elevationDisplay.innerText = Math.max(0, Math.floor(displayAlt));

    // 照片彈窗觸發
    photoFeatures.forEach((f, i) => {
        if (!shownPhotos.has(f.properties.id)) {
            const d = turf.distance(point, f, { units: 'kilometers' });
            if (d < 0.1) { // 100公尺內觸發
                shownPhotos.add(f.properties.id);
                showPhotoCard(f, i);
            }
        }
    });

    map.easeTo({ center: coords, duration: 100, pitch: 60 });
}

function showPhotoCard(f, i) {
    photoCardImg.src = f.properties.objectUrl;
    photoCardLabel.innerText = `照片 #${i+1} - ${f.properties.time || '未知時間'}`;
    photoCard.classList.remove('hidden');
    clearTimeout(photoCardTimeout);
    photoCardTimeout = setTimeout(() => photoCard.classList.add('hidden'), 3000);
}

// --- 5. 動態控制 (唯一版本) ---
function animate(timestamp) {
    if (!isPlaying) return;
    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;
    lastTime = timestamp;

    currentDistance += (playbackSpeed / 1000) * delta;

    if (currentDistance >= totalDistance) {
        currentDistance = totalDistance;
        isPlaying = false;
        toggleButtons();
        updateDisplay(currentDistance);
        setTimeout(showFinalSummary, 500);
        return;
    }

    updateDisplay(currentDistance);
    animationId = requestAnimationFrame(animate);
}

playBtn.addEventListener('click', () => {
    if (!routeLine) return alert('請先上傳照片');
    if (currentDistance >= totalDistance) {
        currentDistance = 0;
        shownPhotos.clear();
        finalPopups.forEach(p => p.remove());
    }
    isPlaying = true;
    lastTime = 0;
    toggleButtons();
    animate(performance.now());
});

pauseBtn.addEventListener('click', () => {
    isPlaying = false;
    toggleButtons();
    cancelAnimationFrame(animationId);
});

function toggleButtons() {
    playBtn.classList.toggle('hidden', isPlaying);
    pauseBtn.classList.toggle('hidden', !isPlaying);
}

function showFinalSummary() {
    photoFeatures.forEach(f => {
        const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '100px' })
            .setLngLat(f.geometry.coordinates)
            .setHTML(`<img src="${f.properties.objectUrl}" style="width:100%; border-radius:4px;">`)
            .addTo(map);
        finalPopups.push(popup);
    });
}