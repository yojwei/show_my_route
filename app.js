// --- 全域變數 ---
let map;
let routeLine = null;
let isPlaying = false;
let animationId = null;
let photoFeatures = [];
let shownPhotos = new Set();
let finalPopups = []; 
let photoCardTimeout = null;

// --- 動態動畫變數 (新導入) ---
let currentSegmentIndex = 0; 
let segmentStartTime = 0;    
const SEGMENT_DURATION = 2000; // 點與點之間固定跑 2 秒

// --- DOM 元件 ---
const uploadInput = document.getElementById('photo-upload');
const photoCard = document.getElementById('photo-card');
const photoCardImg = document.getElementById('photo-card-img');
const photoCardLabel = document.getElementById('photo-card-label');
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');

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

// --- 2. 照片處理 (保留 EXIF 邏輯) ---
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

    // 清理
    photoFeatures.forEach(f => URL.revokeObjectURL(f.properties.objectUrl));
    finalPopups.forEach(p => p.remove());
    finalPopups = [];
    photoFeatures = [];
    shownPhotos.clear();
    currentSegmentIndex = 0;

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

// --- 3. 路徑規劃 (功能補回：串接 OSRM API) ---
async function updateRoute(coords) {
    const pointsStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    try {
        // 使用 OSRM 進行真實道路規劃
        const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${pointsStr}?overview=full&geometries=geojson`);
        const data = await resp.json();
        if (data.code !== 'Ok') throw new Error();
        routeLine = data.routes[0].geometry;
    } catch {
        // 失敗才回退到直線
        routeLine = turf.lineString(coords).geometry;
    }

    map.getSource('route').setData(routeLine);
    const bbox = turf.bbox(routeLine);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
        padding: { left: 400, right: 80, top: 80, bottom: 80 } 
    });
}

// --- 4. 核心動畫 (功能補回：海拔模擬 + 2秒節奏) ---
function animate(timestamp) {
    if (!isPlaying || photoFeatures.length < 2) return;
    if (!segmentStartTime) segmentStartTime = timestamp;

    const elapsed = timestamp - segmentStartTime;
    const progress = Math.min(elapsed / SEGMENT_DURATION, 1);

    // 取得當前路段照片座標
    const startPhoto = photoFeatures[currentSegmentIndex];
    const endPhoto = photoFeatures[currentSegmentIndex + 1];

    // 在 OSRM 路徑中切割出這一段
    const segmentLine = turf.lineSlice(startPhoto, endPhoto, routeLine);
    // 根據 progress 找到該段落中的位置
    const currentPoint = turf.along(segmentLine, turf.length(segmentLine) * progress, { units: 'kilometers' });
    const coords = currentPoint.geometry.coordinates;

    // --- UI 更新 ---
    // 1. 更新點與進度線
    map.getSource('point').setData(currentPoint);
    const partialRoute = turf.lineSlice(turf.point(routeLine.coordinates[0]), currentPoint, routeLine);
    map.getSource('route-progress').setData(partialRoute);

    // 2. 海拔模擬 (功能補回：照片真實海拔 + DEM 差值)
    const baseAlt = startPhoto.properties.altitude;
    const terrainNow = map.queryTerrainElevation(coords);
    const terrainBase = map.queryTerrainElevation(startPhoto.geometry.coordinates);
    
    let displayAlt = baseAlt;
    if (terrainNow !== null && terrainBase !== null) {
        displayAlt = baseAlt + (terrainNow - terrainBase);
    }
    elevationDisplay.innerText = Math.max(0, Math.floor(displayAlt));

    // 3. 距離累計
    const distSoFar = turf.length(partialRoute, { units: 'kilometers' });
    distanceDisplay.innerText = distSoFar.toFixed(2);

    // 4. 視角優化
    if (progress === 0) {
        const segDist = turf.length(segmentLine, { units: 'kilometers' });
        let targetZoom = 15; 
        if (segDist > 2) targetZoom = 13;
        if (segDist > 10) targetZoom = 10;
        
        map.easeTo({ center: coords, zoom: targetZoom, pitch: 60, duration: 1000 });
    } else {
        map.setCenter(coords);
    }

    // 5. 照片彈出
    if (progress < 0.1 && !shownPhotos.has(startPhoto.properties.id)) {
        shownPhotos.add(startPhoto.properties.id);
        showPhotoCard(startPhoto, currentSegmentIndex);
    }

    // 段落切換
    if (progress >= 1) {
        currentSegmentIndex++;
        segmentStartTime = timestamp;
        if (currentSegmentIndex >= photoFeatures.length - 1) {
            isPlaying = false;
            toggleButtons();
            setTimeout(showFinalSummary, 800);
            return;
        }
    }

    animationId = requestAnimationFrame(animate);
}

// --- 5. 最終綜覽畫面 (修正位移) ---
function getOffsetPhotoPosition(map, lonLat, index) {
    const lngOffset = (index % 2 === 0) ? 0.0005 : -0.0005; 
    const latOffset = 0.0008; 
    return [lonLat[0] + lngOffset, lonLat[1] + latOffset];
}

function showFinalSummary() {
    finalPopups.forEach(p => p.remove());
    finalPopups = [];

    photoFeatures.forEach((f, i) => {
        const offsetCoords = getOffsetPhotoPosition(map, f.geometry.coordinates, i);
        const popup = new maplibregl.Popup({ 
            closeButton: false, maxWidth: '120px', anchor: 'center', className: 'final-summary-popup' 
        })
            .setLngLat(offsetCoords)
            .setHTML(`
                <div style="border: 2px solid white; border-radius: 4px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.4); background: white;">
                    <img src="${f.properties.objectUrl}" style="width:100%; display: block; object-fit: cover; height: 70px;">
                </div>
            `)
            .addTo(map);
        finalPopups.push(popup);
    });

    const bbox = turf.bbox(routeLine);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
        padding: 120, pitch: 0, duration: 2500 
    });
}

// --- 6. 控制與其他輔助 ---
function showPhotoCard(f, i) {
    photoCardImg.src = f.properties.objectUrl;
    photoCardLabel.innerText = `照片 #${i+1}`;
    photoCard.classList.remove('hidden');
    clearTimeout(photoCardTimeout);
    photoCardTimeout = setTimeout(() => photoCard.classList.add('hidden'), 3000);
}

playBtn.addEventListener('click', () => {
    if (!photoFeatures.length) return alert('請先上傳照片');
    if (currentSegmentIndex >= photoFeatures.length - 1) {
        currentSegmentIndex = 0;
        shownPhotos.clear();
        finalPopups.forEach(p => p.remove());
    }
    isPlaying = true;
    segmentStartTime = 0; 
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