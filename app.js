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

// --- DOM 元件 ---
const uploadInput = document.getElementById('photo-upload');
const photoCard = document.getElementById('photo-card');
const photoCardImg = document.getElementById('photo-card-img');
const photoCardLabel = document.getElementById('photo-card-label');
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const shareBtn = document.getElementById('share-btn');
const routeTitle = document.getElementById('route-title');

// --- 1. 初始化邏輯 ---
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
            layers: [{ 
                id: 'satellite-layer', 
                type: 'raster', 
                source: 'satellite', 
                paint: { 'raster-saturation': 0.1 } 
            }],
            terrain: { source: 'terrain-source', exaggeration: 1.5 }
        },
        center: [120.9738, 23.6], 
        zoom: 6.5,
        pitch: 0
    });

    map.on('load', () => {
        setupLayers();
        map.resize();
    });
}

function setupLayers() {
    if (map.getSource('route')) return;
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'route-preview', type: 'line', source: 'route', paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.5 } });
    map.addSource('route-progress', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'route-progress', type: 'line', source: 'route-progress', paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-cap': 'round' } });
    map.addSource('point', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [] } } });
    map.addLayer({ id: 'point-circle', type: 'circle', source: 'point', paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#3b82f6' } });
    map.addSource('photos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'photo-markers', type: 'circle', source: 'photos', paint: { 'circle-radius': 8, 'circle-color': '#bfdbfe', 'circle-stroke-width': 2, 'circle-stroke-color': '#60a5fa' } });
}

// --- 2. 照片處理與路徑生成 ---
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

async function updateRoute(coords) {
    const pointsStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    try {
        const resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${pointsStr}?overview=full&geometries=geojson`);
        const data = await resp.json();
        routeLine = (data.code === 'Ok') ? data.routes[0].geometry : turf.lineString(coords).geometry;
    } catch {
        routeLine = turf.lineString(coords).geometry;
    }

    totalDistance = turf.length(routeLine, { units: 'kilometers' });
    currentDistance = 0;
    map.getSource('route').setData(routeLine);
    
    const bbox = turf.bbox(routeLine);
    const leftPad = window.innerWidth < 800 ? 50 : 450; 
    const rightPad = window.innerWidth < 800 ? 50 : 150;

    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
        padding: { left: leftPad, right: rightPad, top: 150, bottom: 100 },
        duration: 1500,
        essential: true
    });
}

// --- 3. 視角計算與動態顯示 ---
function getSegmentConfig(dist) {
    if (!routeLine || photoFeatures.length < 2) return { speed: 400, zoom: 15, pitch: 60 };

    let currentIndex = 0;
    for (let i = 0; i < photoFeatures.length; i++) {
        const photoDist = turf.length(turf.lineSlice(turf.point(routeLine.coordinates[0]), photoFeatures[i], routeLine), { units: 'kilometers' });
        if (photoDist <= dist) currentIndex = i;
        else break;
    }

    const p1 = photoFeatures[currentIndex];
    const p2 = photoFeatures[currentIndex + 1];
    
    if (!p2) return { speed: 100, zoom: 15, pitch: 60 }; 

    const segmentDist = turf.distance(p1, p2, { units: 'kilometers' });
    let targetSeconds, finalZoom, finalPitch;

    if (segmentDist > 10) {      
        targetSeconds = 3; finalZoom = 10; finalPitch = 40;
    } else if (segmentDist > 3) {
        targetSeconds = 2; finalZoom = 13; finalPitch = 50;
    } else if (segmentDist < 0.5) {
        targetSeconds = 1.5; finalZoom = 18; finalPitch = 70;
    } else {
        targetSeconds = 2; finalZoom = 15.5; finalPitch = 60;
    }

    const calculatedSpeed = (segmentDist / targetSeconds) * 3600;
    return { speed: calculatedSpeed, zoom: finalZoom, pitch: finalPitch };
}

function updateDisplay(dist) {
    if (!routeLine) return;
    const point = turf.along(routeLine, dist, { units: 'kilometers' });
    const coords = point.geometry.coordinates;

    const prog = turf.lineSlice(turf.point(routeLine.coordinates[0]), point, routeLine);
    map.getSource('route-progress').setData(prog);
    map.getSource('point').setData(point);
    distanceDisplay.innerText = dist.toFixed(2);

    const currentTerrainAlt = map.queryTerrainElevation(coords) || 0;
    let prevPhoto = null, nextPhoto = null;

    for (let i = 0; i < photoFeatures.length; i++) {
        const photoDist = turf.length(turf.lineSlice(turf.point(routeLine.coordinates[0]), photoFeatures[i], routeLine), { units: 'kilometers' });
        if (photoDist <= dist) prevPhoto = photoFeatures[i];
        else { nextPhoto = photoFeatures[i]; break; }
    }

    let finalAltitude = currentTerrainAlt;
    if (prevPhoto && nextPhoto) {
        const d1 = turf.length(turf.lineSlice(turf.point(routeLine.coordinates[0]), prevPhoto, routeLine), { units: 'kilometers' });
        const d2 = turf.length(turf.lineSlice(turf.point(routeLine.coordinates[0]), nextPhoto, routeLine), { units: 'kilometers' });
        const offset1 = (prevPhoto.properties.altitude || 0) - (map.queryTerrainElevation(prevPhoto.geometry.coordinates) || 0);
        const offset2 = (nextPhoto.properties.altitude || 0) - (map.queryTerrainElevation(nextPhoto.geometry.coordinates) || 0);
        const ratio = (dist - d1) / (d2 - d1);
        finalAltitude = currentTerrainAlt + (offset1 + (offset2 - offset1) * ratio);
    } else if (prevPhoto || nextPhoto) {
        const target = prevPhoto || nextPhoto;
        const offset = (target.properties.altitude || 0) - (map.queryTerrainElevation(target.geometry.coordinates) || 0);
        finalAltitude = currentTerrainAlt + offset;
    }
    elevationDisplay.innerText = Math.max(0, Math.floor(finalAltitude));

    photoFeatures.forEach((f, i) => {
        if (!shownPhotos.has(f.properties.id) && turf.distance(point, f, { units: 'kilometers' }) < 0.15) {
            shownPhotos.add(f.properties.id);
            showPhotoCard(f, i);
        }
    });

    const segConfig = getSegmentConfig(dist);
    const leftPad = window.innerWidth < 800 ? 50 : 450;

    map.easeTo({ 
        center: coords, 
        zoom: segConfig.zoom,
        pitch: segConfig.pitch,
        padding: { left: leftPad },
        duration: 300, 
        essential: true
    });
}

function showPhotoCard(f, i) {
    if (!isPlaying || (currentDistance / totalDistance) > 0.99) {
        photoCard.classList.add('hidden');
        return;
    }

    photoCardImg.src = f.properties.objectUrl;
    photoCardLabel.innerText = `照片 #${i + 1}`;
    
    clearTimeout(photoCardTimeout);
    photoCard.classList.remove('hidden');

    photoCardTimeout = setTimeout(() => {
        photoCard.classList.add('hidden');
    }, 3500);
}

// --- 4. 最終綜覽模組 ---
// 補回遺失的叢集演算法
function clusterPoints(features, distanceKm) {
    const clusters = [];
    const usedIndices = new Set();

    for (let i = 0; i < features.length; i++) {
        if (usedIndices.has(i)) continue;
        
        const cluster = { type: 'FeatureCollection', features: [features[i]] };
        usedIndices.add(i);

        for (let j = i + 1; j < features.length; j++) {
            if (usedIndices.has(j)) continue;
            
            const dist = turf.distance(features[i], features[j], { units: 'kilometers' });
            if (dist <= distanceKm) {
                cluster.features.push(features[j]);
                usedIndices.add(j);
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

function showFinalSummary() {
    if (finalPopups.length > 0) return;
    photoCard.classList.add('hidden');

    const clusters = clusterPoints(photoFeatures, 0.2);

    clusters.forEach(cluster => {
        const count = cluster.features.length;
        const center = turf.center(cluster).geometry.coordinates;

        cluster.features.forEach((f, i) => {
            const angle = (i / count) * 360;
            const currentZoom = map.getZoom();
            const radius = Math.pow(2, 16 - currentZoom) * 80; 

            const dest = turf.destination(turf.point(center), radius / 1000, angle, { units: 'kilometers' });
            const finalLngLat = dest.geometry.coordinates;

            const popup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                anchor: 'center',
                className: 'final-summary-popup radial-popup'
            })
            .setLngLat(finalLngLat)
            .setHTML(`
                <div class="summary-img-container" style="animation-delay: ${i * 0.1}s">
                    <img src="${f.properties.objectUrl}" style="width:120px; height:90px; object-fit:cover;">
                    <div class="connection-line" style="transform: rotate(${angle + 90}deg); width: ${radius}px;"></div>
                </div>
            `)
            .addTo(map);

            finalPopups.push(popup);
        });
    });
}

// --- 5. 截圖下載功能 ---
shareBtn.addEventListener('click', async () => {
    if (!routeLine) return alert('請先產生路徑並進入綜覽畫面');

    shareBtn.disabled = true;
    const originalBtnText = shareBtn.innerHTML;
    shareBtn.innerText = "截圖生成中...";

    try {
        const mapContainer = document.getElementById('map');
        const canvas = await html2canvas(mapContainer, {
            useCORS: true,           
            allowTaint: true,
            scale: 2,                
            ignoreElements: (el) => el.classList.contains('maplibregl-ctrl')
        });

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = canvas.width;
        finalCanvas.height = canvas.height;
        const ctx = finalCanvas.getContext('2d');

        ctx.drawImage(canvas, 0, 0);

        const name = routeTitle.innerText.trim() || "我的旅程路徑";
        const dates = photoFeatures.map(f => f.properties.time).filter(t => t);
        const dateText = dates.length ? `${dates[0]} - ${dates[dates.length-1]}` : "";

        ctx.fillStyle = "white";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 15;
        ctx.textAlign = "right";
        
        ctx.font = "bold 60px 'Microsoft JhengHei', sans-serif";
        ctx.fillText(name, finalCanvas.width - 60, finalCanvas.height - 120);
        
        ctx.font = "40px 'Microsoft JhengHei', sans-serif";
        ctx.fillText(dateText, finalCanvas.width - 60, finalCanvas.height - 60);

        const link = document.createElement('a');
        link.download = `${name}.png`;
        link.href = finalCanvas.toDataURL('image/png');
        link.click();

    } catch (e) {
        console.error("截圖失敗:", e);
        alert("截圖失敗，請稍後再試。");
    } finally {
        shareBtn.disabled = false;
        shareBtn.innerHTML = originalBtnText;
    }
});

// --- 6. 播放控制 ---
function animate(timestamp) {
    if (!isPlaying) return;
    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;
    lastTime = timestamp;

    const config = getSegmentConfig(currentDistance); 
    const kmPerMs = config.speed / 3600000;           
    currentDistance += kmPerMs * delta;

    if (currentDistance >= totalDistance) {
        currentDistance = totalDistance;
        isPlaying = false;
        toggleButtons();
        updateDisplay(currentDistance);

        clearTimeout(photoCardTimeout);
        photoCard.classList.add('hidden'); 

        const bbox = turf.bbox(routeLine);
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
            padding: { left: 150, right: 150, top: 150, bottom: 150 }, 
            duration: 2000,
            essential: true
        });

        map.once('moveend', () => {
            photoCard.classList.add('hidden'); 
            showFinalSummary();
        });
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
    lastTime = performance.now();
    toggleButtons();
    animate(lastTime);
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