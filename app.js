// --- 全域變數 ---
let map;
let routeLine = null;
let totalDistance = 0;
let currentDistance = 0;
let isPlaying = false;
let animationId = null;
let lastTime = 0;
let photoFeatures = [];
let shownPhotos = new Set();
let finalPopups = []; 
let photoCardTimeout = null;

// --- 速度與視角配置 (目標時間導向) ---
const speedConfigs = [
    { duration: 30, icon: 'footprints', label: '慢速巡航', zoom: 16, pitch: 60 }, 
    { duration: 15, icon: 'car',        label: '標準快進', zoom: 12, pitch: 45 }, 
    { duration: 5,  icon: 'bird',       label: '極速鳥瞰', zoom: 6,  pitch: 30 }
];
let currentSpeedIndex = 0;

// --- DOM 元件 ---
const uploadInput = document.getElementById('photo-upload');
const photoCard = document.getElementById('photo-card');
const photoCardImg = document.getElementById('photo-card-img');
const photoCardLabel = document.getElementById('photo-card-label');
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const speedBtn = document.getElementById('speed-btn');
const iconContainer = document.getElementById('speed-icon-container');

// --- 1. 初始化 ---
document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initMap();
});

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
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'route-preview', type: 'line', source: 'route', paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [2, 2] } });

    map.addSource('route-progress', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'route-progress', type: 'line', source: 'route-progress', paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-cap': 'round' } });

    map.addSource('point', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [] } } });
    map.addLayer({ id: 'point-circle', type: 'circle', source: 'point', paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#3b82f6' } });

    map.addSource('photos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'photo-markers', type: 'circle', source: 'photos', paint: { 'circle-radius': 8, 'circle-color': '#bfdbfe', 'circle-stroke-width': 2, 'circle-stroke-color': '#60a5fa' } });
}

// --- 2. 照片處理 (EXIF) ---
if (uploadInput) uploadInput.addEventListener('change', handleUpload);

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

                const toDec = (dms, ref) => {
                    if (!dms) return null;
                    let dec = dms[0] + dms[1] / 60 + dms[2] / 3600;
                    return (ref === 'S' || ref === 'W') ? -dec : dec;
                };

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
            properties: { id: `photo-${i}`, altitude: m.altitude, time: m.time, objectUrl: URL.createObjectURL(m.file) }
        });
    });

    photoFeatures.sort((a, b) => new Date(a.properties.time) - new Date(b.properties.time));
    map.getSource('photos').setData({ type: 'FeatureCollection', features: photoFeatures });

    const coords = photoFeatures.map(f => f.geometry.coordinates);
    if (coords.length >= 2) await updateRoute(coords);
}

// --- 3. 路徑規劃與自動定位 ---
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
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
        padding: { left: 400, right: 80, top: 80, bottom: 80 } 
    });
}

// --- 4. 核心動畫顯示 ---
function updateDisplay(dist) {
    if (!routeLine) return;
    const point = turf.along(routeLine, dist, { units: 'kilometers' });
    const coords = point.geometry.coordinates;

    const prog = turf.lineSlice(turf.point(routeLine.coordinates[0]), point, routeLine);
    map.getSource('route-progress').setData(prog);
    map.getSource('point').setData(point);
    distanceDisplay.innerText = dist.toFixed(2);

    // 高度計算
    let closest = null, minD = Infinity;
    photoFeatures.forEach(f => {
        const d = turf.distance(point, f, { units: 'kilometers' });
        if (d < minD) { minD = d; closest = f; }
    });
    const baseAlt = closest ? closest.properties.altitude : 0;
    const terrainNow = map.queryTerrainElevation(coords);
    const terrainBase = closest ? map.queryTerrainElevation(closest.geometry.coordinates) : null;
    let displayAlt = (terrainNow !== null && terrainBase !== null) ? baseAlt + (terrainNow - terrainBase) : baseAlt;
    elevationDisplay.innerText = Math.max(0, Math.floor(displayAlt));

    // 觸發單張照片卡片
    photoFeatures.forEach((f, i) => {
        if (!shownPhotos.has(f.properties.id)) {
            if (turf.distance(point, f, { units: 'kilometers' }) < 0.1) {
                shownPhotos.add(f.properties.id);
                showPhotoCard(f, i);
            }
        }
    });

    const config = speedConfigs[currentSpeedIndex];
    map.easeTo({ 
        center: coords, 
        zoom: config.zoom, 
        pitch: config.pitch,
        offset: [175, 0], // 閃避左側卡片
        duration: 100 
    });
}

function showPhotoCard(f, i) {
    photoCardImg.src = f.properties.objectUrl;
    photoCardLabel.innerText = `照片 #${i+1}`;
    photoCard.classList.remove('hidden');
    clearTimeout(photoCardTimeout);
    photoCardTimeout = setTimeout(() => photoCard.classList.add('hidden'), 3000);
}

// --- 5. 最終綜覽畫面邏輯 ---

// 計算偏移位置，避免蓋住原本的路徑
function getOffsetPhotoPosition(map, lonLat) {
    const pixel = map.project(lonLat);
    const offsetPixel = { x: pixel.x + 35, y: pixel.y - 35 }; // 向右上方偏移
    return map.unproject(offsetPixel);
}

function showFinalSummary() {
    finalPopups.forEach(p => p.remove());
    finalPopups = [];

    // 1. 生成所有照片的綜覽彈窗
    photoFeatures.forEach(f => {
        // 使用偏移坐標，讓線條露出來
        const offsetCoords = getOffsetPhotoPosition(map, f.geometry.coordinates);

        const popup = new maplibregl.Popup({ 
            closeButton: false, 
            maxWidth: '100px', 
            anchor: 'center',
            className: 'final-summary-popup' // 套用去背 CSS
        })
            .setLngLat(offsetCoords)
            .setHTML(`
                <div style="border: 2px solid white; border-radius: 4px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
                    <img src="${f.properties.objectUrl}" style="width:100%; display: block;">
                </div>
            `)
            .addTo(map);
        finalPopups.push(popup);
    });

    // 2. 自動縮放到全局視角，並閃避左側卡片
    if (routeLine) {
        const bbox = turf.bbox(routeLine);
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
            padding: { left: 450, right: 100, top: 100, bottom: 100 }, 
            pitch: 0,
            duration: 2000
        });
    }
}

// --- 6. 動態播放控制 ---
function animate(timestamp) {
    if (!isPlaying) return;
    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;
    lastTime = timestamp;

    const targetDuration = speedConfigs[currentSpeedIndex].duration;
    const distancePerMs = totalDistance / (targetDuration * 1000);
    currentDistance += distancePerMs * delta;

    if (currentDistance >= totalDistance) {
        currentDistance = totalDistance;
        isPlaying = false;
        toggleButtons();
        updateDisplay(currentDistance);
        setTimeout(showFinalSummary, 800); // 動畫結束觸發綜覽
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

// --- 7. 速度切換 ---
if (speedBtn) {
    speedBtn.addEventListener('click', () => {
        currentSpeedIndex = (currentSpeedIndex + 1) % speedConfigs.length;
        const config = speedConfigs[currentSpeedIndex];
        
        speedBtn.title = config.label;
        iconContainer.innerHTML = `<i data-lucide="${config.icon}" class="w-5 h-5 stroke-[1.5]"></i>`;
        lucide.createIcons();
        
        map.flyTo({ 
            zoom: config.zoom, 
            pitch: config.pitch, 
            offset: [175, 0],
            duration: 1000 
        });
        
        speedBtn.classList.add('scale-90');
        setTimeout(() => speedBtn.classList.remove('scale-90'), 100);
    });
}