// --- 全域變數 ---
let map, animationId;
let routeLine;
let totalDistance = 0;
let currentDistance = 0;
let isPlaying = false;
let lastTime = 0;
let playbackSpeed = 1.0;
let photos = []; // 儲存照片資料
let shownPhotos = new Set(); // 記錄已顯示的照片索引，避免重複顯示 

// DOM 元素
const routeTitle = document.getElementById('route-title');
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const photoCard = document.getElementById('photo-card');
const photoCardImg = document.getElementById('photo-card-img');
const photoCardLabel = document.getElementById('photo-card-label');
const photoCardClose = document.getElementById('photo-card-close');
let photoCardTimeout = null;

// --- 1. 核心處理 ---
function getPhotoMetadata(file) {
    return new Promise(resolve => {
        EXIF.getData(file, function() {
            const lat = EXIF.getTag(this, "GPSLatitude");
            const lon = EXIF.getTag(this, "GPSLongitude");
            const latRef = EXIF.getTag(this, "GPSLatitudeRef") || "N";
            const lonRef = EXIF.getTag(this, "GPSLongitudeRef") || "E";
            const date = EXIF.getTag(this, "DateTimeOriginal");
            if (lat && lon) {
                const toDec = (dms, ref) => (dms[0] + dms[1]/60 + dms[2]/3600) * (ref === "S" || ref === "W" ? -1 : 1);
                resolve({ coords: [toDec(lon, lonRef), toDec(lat, latRef)], time: new Date(date.replace(/:/g, '/')) });
            } else resolve(null);
        });
    });
}

function updateGlobalRouteData(coords) {
    if (coords.length < 2) return;
    routeLine = turf.lineString(coords);
    totalDistance = turf.length(routeLine, { units: 'kilometers' });
    currentDistance = 0; 
    isPlaying = false;
    toggleButtons();

    if (map && map.isStyleLoaded()) {
        map.getSource('full-route').setData(routeLine);
        map.getSource('route-progress').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
        map.getSource('point').setData(turf.point(coords[0]));
    }
}

// --- 2. 地圖初始化 ---
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'satellite': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256 },
                //'terrain-source': { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256 }
            },
            layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }],
            terrain: { source: 'terrain-source', exaggeration: 1.5 }
        },
        center: [120.88, 23.48], zoom: 13, pitch: 60, bearing: 150
    });

    map.on('load', () => {
        map.addSource('full-route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
        map.addLayer({ id: 'route-bg', type: 'line', source: 'full-route', paint: { 'line-color': '#4b5563', 'line-width': 5, 'line-opacity': 0.4 } });
        map.addSource('route-progress', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
        map.addLayer({ id: 'route-fg', type: 'line', source: 'route-progress', paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-cap': 'round', 'line-join': 'round' } });
        map.addSource('point', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [] } } });
        map.addLayer({ id: 'point-circle', type: 'circle', source: 'point', paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#3b82f6' } });
    });
}

function getFallbackElevation(point) {
    const fallbackCandidates = [
        point?.properties?.ele,
        point?.properties?.elevation,
        point?.properties?.altitude,
        point?.geometry?.coordinates?.[2]
    ];
    const fallback = fallbackCandidates.find(value => Number.isFinite(Number(value)));
    return fallback !== undefined ? Number(fallback) : null;
}

function getPointElevation(point) {
    const coordinates = point?.geometry?.coordinates;
    let terrainElevation = null;

    if (typeof map?.queryTerrainElevation === 'function' && Array.isArray(coordinates)) {
        terrainElevation = map.queryTerrainElevation(coordinates);
    }

    if (Number.isFinite(terrainElevation)) return terrainElevation;
    return getFallbackElevation(point);
}

function showPhotoCard({ url, time }, index) {
    if (!photoCard) return;
    photoCardImg.src = url;
    photoCardLabel.textContent = `照片 #${index + 1} · ${time.toLocaleString()}`;
    photoCard.classList.remove('hidden');

    // 暫停動畫，3秒後關閉並恢復播放
    if (isPlaying) {
        isPlaying = false;
        toggleButtons();
        cancelAnimationFrame(animationId);
    }

    if (photoCardTimeout) clearTimeout(photoCardTimeout);
    photoCardTimeout = setTimeout(() => {
        hidePhotoCard();
        isPlaying = true;
        toggleButtons();
        lastTime = 0;
        animationId = requestAnimationFrame(animate);
    }, 3000);
}

function hidePhotoCard() {
    if (!photoCard) return;
    photoCard.classList.add('hidden');
    if (photoCardTimeout) {
        clearTimeout(photoCardTimeout);
        photoCardTimeout = null;
    }
}

function checkAndShowPhoto(currentPoint) {
    if (!photos || photos.length === 0) return;
    // 已顯示過或正在顯示的直接跳過
    if (!photoCard || !photoCard.classList.contains('hidden')) return;

    for (let i = 0; i < photos.length; i++) {
        if (shownPhotos.has(i)) continue;

        const photoPoint = turf.point(photos[i].coords);
        const distanceKm = turf.distance(currentPoint, photoPoint, { units: 'kilometers' });
        if (distanceKm <= 0.05) { // 50 公尺標準
            shownPhotos.add(i);
            showPhotoCard(photos[i], i);
            break;
        }
    }
}

// --- 3. 動畫控制 ---
function animate(timestamp) {
    if (!isPlaying) return;
    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;
    lastTime = timestamp;

    const speed = (totalDistance / 20) * playbackSpeed * 0.05; 
    currentDistance += speed * (delta / 1000);

    if (currentDistance >= totalDistance) {
        currentDistance = totalDistance;
        isPlaying = false;
        toggleButtons();
    }

    const currentPoint = turf.along(routeLine, currentDistance, { units: 'kilometers' });
    const progressLine = turf.lineSlice(turf.point(routeLine.geometry.coordinates[0]), currentPoint, routeLine);

    map.getSource('route-progress').setData(progressLine);
    map.getSource('point').setData(currentPoint);

    distanceDisplay.innerText = currentDistance.toFixed(2);

const elev = getPointElevation(currentPoint);
    elevationDisplay.innerText = Number.isFinite(elev) ? Math.floor(elev) : "---";

    map.jumpTo({ center: currentPoint.geometry.coordinates, pitch: 65, zoom: 15 });
    animationId = requestAnimationFrame(animate);
}

function toggleButtons() {
    playBtn.classList.toggle('hidden', isPlaying);
    pauseBtn.classList.toggle('hidden', !isPlaying);
}

// --- 4. 事件繫結 ---
document.getElementById('photo-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length < 2) return alert("請至少選擇兩張照片");

    const metaResults = await Promise.all(files.map(getPhotoMetadata));
    photos = [];
    const noGpsPhotos = [];

    for (let i = 0; i < files.length; i++) {
        const meta = metaResults[i];
        if (meta) {
            photos.push({ coords: meta.coords, time: meta.time, url: URL.createObjectURL(files[i]) });
        } else {
            noGpsPhotos.push(files[i]);
        }
    }

    if (photos.length < 2) {
        return alert("至少需要兩張有GPS資訊的照片來製作路線");
    }

    shownPhotos.clear();
    const sortedPhotos = photos.sort((a, b) => a.time - b.time);
    const sortedCoords = sortedPhotos.map(p => p.coords);
    // 重新指定排序後的 photos
    photos = sortedPhotos;

    updateGlobalRouteData(sortedCoords);

    const bbox = turf.bbox(routeLine);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 80, duration: 2000 });

    if (noGpsPhotos.length > 0) {
        console.warn(`${noGpsPhotos.length} 張照片沒有 GPS 資訊，不會被納入軌跡`);
    }
});

playBtn.addEventListener('click', () => {
    if (!routeLine) return alert("請先上傳照片");
    if (currentDistance >= totalDistance) currentDistance = 0;
    isPlaying = true;
    lastTime = 0;
    toggleButtons();
    animationId = requestAnimationFrame(animate);
});

pauseBtn.addEventListener('click', () => {
    isPlaying = false;
    toggleButtons();
    cancelAnimationFrame(animationId);
});

if (photoCardClose) {
    photoCardClose.addEventListener('click', () => {
        hidePhotoCard();
        if (photoCardTimeout) {
            clearTimeout(photoCardTimeout);
            photoCardTimeout = null;
        }
        isPlaying = true;
        toggleButtons();
        lastTime = 0;
        animationId = requestAnimationFrame(animate);
    });
}

initMap();

initMap();
