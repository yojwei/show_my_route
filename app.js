// --- 全域變數 ---
let map;
let routeLine = null;
let totalDistance = 0;
let currentDistance = 0;
let isPlaying = false;
let isPhotoPausing = false; 
let animationId = null;
let lastTime = 0;
let photoFeatures = [];
let shownPhotos = new Set();
let currentCameraZoom = null;
let currentCameraPitch = null;
let mediaRecorder = null; 
let recordedChunks = []; 
let isRecordingVideo = false; 

// --- DOM 元件 ---
const uploadInput = document.getElementById('photo-upload');
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const shareBtn = document.getElementById('share-btn');
const routeTitle = document.getElementById('route-title');
const downloadVideoBtn = document.getElementById('download-video-btn');

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
    map.addLayer({ 
    id: 'route-progress', 
    type: 'line', 
    source: 'route-progress', 
    layout: {
        'line-cap': 'round',
        'line-join': 'round'
    },
    paint: { 
        'line-color': '#3b82f6', 
        'line-width': 6 
    } 
});
    map.addSource('point', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [] } } });
    map.addLayer({ id: 'point-circle', type: 'circle', source: 'point', paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#3b82f6' } });
    map.addSource('photos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'photo-markers', type: 'circle', source: 'photos', paint: { 'circle-radius': 8, 'circle-color': '#bfdbfe', 'circle-stroke-width': 2, 'circle-stroke-color': '#60a5fa' } });

    // 👇 新增：動畫途中的彈出照片圖層
    map.addSource('active-photo', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'photo-layer',
        type: 'symbol',
        source: 'active-photo',
        layout: {
            'icon-image': ['get', 'iconName'],
            'icon-size': 0.6, // 這裡可以調整彈出照片的大小
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-offset': [0, -120] // 往上偏移，避免擋住藍色圓點
        }
    });

    // 👇 新增：最終總覽畫面的群集照片圖層
    map.addSource('final-photos', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
        id: 'final-photo-layer',
        type: 'symbol',
        source: 'final-photos',
        layout: {
            'icon-image': ['get', 'iconName'],
            'icon-size': 0.45, // 總覽畫面的照片稍小一點
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        }
    });
}

// --- 2. 照片處理、拍立得合成與路徑生成 ---
if (uploadInput) uploadInput.addEventListener('change', handleUpload);

/**
 * 將圖片與日期文字合成一張拍立得風格的圖片 (Canvas)
 */
function createPolaroidImage(imgElement, dateText) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const w = 400;
    const h = 480; // 拍立得下方要留白寫字
    canvas.width = w;
    canvas.height = h;

    // 1. 畫白色背景與陰影
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 15;
    ctx.fillRect(15, 15, w - 30, h - 30);

    // 2. 畫照片 (處理 object-fit: cover 的置中裁切邏輯)
    const photoW = w - 60;
    const photoH = photoW; 
    const imgRatio = imgElement.naturalWidth / imgElement.naturalHeight;
    let sX = 0, sY = 0, sW = imgElement.naturalWidth, sH = imgElement.naturalHeight;
    
    if (imgRatio > 1) { // 橫圖
        sW = sH;
        sX = (imgElement.naturalWidth - sW) / 2;
    } else { // 直圖
        sH = sW;
        sY = (imgElement.naturalHeight - sH) / 2;
    }
    
    ctx.shadowBlur = 0; // 照片本體不需要陰影
    ctx.drawImage(imgElement, sX, sY, sW, sH, 30, 30, photoW, photoH);

    // 3. 寫日期文字
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 24px "Courier New", Courier, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(dateText, w / 2, h - 45);

    return canvas;
}

// 預先將所有照片轉換為 MapLibre Icon
async function loadAllPhotosAsIcons() {
    for (let i = 0; i < photoFeatures.length; i++) {
        const photo = photoFeatures[i];
        const img = new Image();
        img.src = photo.properties.objectUrl;

        await new Promise(resolve => {
            img.onload = () => {
                const date = photo.properties.time || "Unknown Date";
                const polaroidCanvas = createPolaroidImage(img, date);
                
                // 將 Canvas 轉為 ImageData 並存入地圖，這樣 final-photo-layer 才抓得到圖
                const ctx = polaroidCanvas.getContext('2d');
                const imageData = ctx.getImageData(0, 0, polaroidCanvas.width, polaroidCanvas.height);
                const iconName = `polaroid-${photo.properties.index}`;
                
                if (map.hasImage(iconName)) map.removeImage(iconName);
                map.addImage(iconName, imageData);
                resolve(); // 記得要 resolve
            };
            img.onerror = () => resolve(); 
        });
    }
}

async function handleUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    // 清除舊資料
    photoFeatures.forEach(f => URL.revokeObjectURL(f.properties.objectUrl));
    if (map.getSource('active-photo')) map.getSource('active-photo').setData({ type: 'FeatureCollection', features: [] });
    if (map.getSource('final-photos')) map.getSource('final-photos').setData({ type: 'FeatureCollection', features: [] });
    photoFeatures = [];
    shownPhotos.clear();

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

    metadata.forEach((m, i) => {
        if (!m.coords) return;
        photoFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: m.coords },
            properties: { id: `photo-${i}`, altitude: m.altitude, time: m.time, objectUrl: URL.createObjectURL(m.file) }
        });
    });

    // 依時間排序並賦予固定的 index 供後續存取 Icon 使用
    photoFeatures.sort((a, b) => new Date(a.properties.time) - new Date(b.properties.time));
    photoFeatures.forEach((f, i) => f.properties.index = i);

    map.getSource('photos').setData({ type: 'FeatureCollection', features: photoFeatures });

    // 開始將照片轉為地圖 Icon
    await loadAllPhotosAsIcons();

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

    photoFeatures.forEach(f => {
        const sliced = turf.lineSlice(turf.point(routeLine.coordinates[0]), f, routeLine);
        const dist = turf.length(sliced, { units: 'kilometers' });
        f.properties.routeDistance = Math.min(dist, totalDistance); 
    });

    map.getSource('route').setData(routeLine);
    
    const bbox = turf.bbox(routeLine);
    const leftPad = window.innerWidth < 800 ? 50 : 450; 
    const rightPad = window.innerWidth < 800 ? 50 : 150;

    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
        padding: { left: leftPad, right: rightPad, top: 150, bottom: 100 },
        duration: 1500,
        maxZoom: 18, 
        essential: true
    });
}

// --- 3. 視角計算與動態顯示 ---
function getSegmentConfig(dist) {
    if (!routeLine || photoFeatures.length < 2) return { speed: 400, zoom: 15, pitch: 60 };

    let currentIndex = 0;
    for (let i = 0; i < photoFeatures.length; i++) {
        if (photoFeatures[i].properties.routeDistance <= dist) currentIndex = i;
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
        targetSeconds = 1.5; finalZoom = 17; finalPitch = 70;
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
        if (photoFeatures[i].properties.routeDistance <= dist) prevPhoto = photoFeatures[i];
        else { nextPhoto = photoFeatures[i]; break; }
    }

    let finalAltitude = currentTerrainAlt;
    if (prevPhoto && nextPhoto) {
        const d1 = prevPhoto.properties.routeDistance;
        const d2 = nextPhoto.properties.routeDistance;
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

    let triggeredPhoto = false;

    for (let i = 0; i < photoFeatures.length; i++) {
        const f = photoFeatures[i];
        if (!shownPhotos.has(f.properties.id) && dist >= f.properties.routeDistance) {
            shownPhotos.add(f.properties.id);
            showPhotoCard(f);
            triggeredPhoto = true; 
            break; 
        }
    }

    if (triggeredPhoto) {
        isPhotoPausing = true;
        setTimeout(() => {
            // 隱藏目前顯示的照片
            map.getSource('active-photo').setData({ type: 'FeatureCollection', features: [] });
            
            if (isPlaying) { 
                isPhotoPausing = false;
                lastTime = performance.now(); 
                animate(lastTime);
            }
        }, 2000); 
    }

    const segConfig = getSegmentConfig(dist);
    const leftPad = window.innerWidth < 800 ? 50 : 450;

    if (currentCameraZoom === null) currentCameraZoom = map.getZoom();
    if (currentCameraPitch === null) currentCameraPitch = map.getPitch();

    currentCameraZoom += (segConfig.zoom - currentCameraZoom) * 0.05;
    currentCameraPitch += (segConfig.pitch - currentCameraPitch) * 0.05;

    map.jumpTo({ 
        center: coords, 
        zoom: currentCameraZoom,
        pitch: currentCameraPitch,
        padding: { left: leftPad }
    });
}

// 改用 MapLibre Native Layer 顯示彈出照片
function showPhotoCard(f) {
    if (!isPlaying) return;
    map.getSource('active-photo').setData({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: f.geometry,
            properties: { iconName: `polaroid-${f.properties.index}` }
        }]
    });
}

// --- 4. 最終綜覽模組 ---
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
    // 確保只執行一次
    if (map.getSource('final-photos')._data.features.length > 0) return;
    map.getSource('active-photo').setData({ type: 'FeatureCollection', features: [] });

    const clusters = clusterPoints(photoFeatures, 0.2);
    const clusterBearings = clusters.map((cluster, index) => {
        if (clusters.length < 2) return 0;
        let p1, p2;
        if (index === 0) {
            p1 = turf.center(clusters[0]);
            p2 = turf.center(clusters[1]);
        } else if (index === clusters.length - 1) {
            p1 = turf.center(clusters[index - 1]);
            p2 = turf.center(clusters[index]);
        } else {
            p1 = turf.center(clusters[index - 1]);
            p2 = turf.center(clusters[index + 1]);
        }
        return turf.bearing(p1, p2);
    });

    let globalZigzag = 0; 
    const finalFeatures = [];

    clusters.forEach((cluster, clusterIndex) => {
        const center = turf.center(cluster).geometry.coordinates;
        const routeBearing = clusterBearings[clusterIndex];
        const relativeAngles = [-90, 90, -45, 45, -135, 135, -180, 0];

        cluster.features.forEach((f, featureIndex) => {
            let offsetAngle;
            if (cluster.features.length === 1) {
                offsetAngle = (globalZigzag % 2 === 0) ? -90 : 90;
                globalZigzag++;
            } else {
                offsetAngle = relativeAngles[featureIndex % relativeAngles.length];
            }

            const finalAngle = routeBearing + offsetAngle;
            const currentZoom = map.getZoom();
            const radiusMultiplier = 1 + Math.floor(featureIndex / 2) * 0.4; 
            const radius = Math.pow(2, 16 - currentZoom) * 90 * radiusMultiplier;

            const dest = turf.destination(turf.point(center), radius / 1000, finalAngle, { units: 'kilometers' });
            const finalLngLat = dest.geometry.coordinates;

            // 將照片加入最終圖層資料庫
            finalFeatures.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: finalLngLat },
                properties: { iconName: `polaroid-${f.properties.index}` }
            });
        });
    });

    // 渲染最終的拍立得群集
    map.getSource('final-photos').setData({ type: 'FeatureCollection', features: finalFeatures });
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
    if (!isPlaying || isPhotoPausing) return;

    if (!lastTime) lastTime = timestamp;
    const delta = timestamp - lastTime;
    lastTime = timestamp;

    const config = getSegmentConfig(currentDistance); 
    const kmPerMs = config.speed / 3600000;           
    currentDistance += kmPerMs * delta;

    let isEnd = false;
    if (currentDistance >= totalDistance) {
        currentDistance = totalDistance;
        isEnd = true;
    }
    
    updateDisplay(currentDistance);

    if (isPhotoPausing) return; 

    if (isEnd) {
        isPlaying = false;
        toggleButtons();

        // 👇 【關鍵新增】強制重繪機制
        // 為了防止影片在靜止畫面時自己卡掉，我們強迫地圖每 33 毫秒更新一次畫布 (約 30 FPS)
        let repaintInterval = null;
        if (isRecordingVideo) {
            repaintInterval = setInterval(() => {
                if (map) map.triggerRepaint();
            }, 33); 
        }

        // 1. 先讓地圖飛回總覽範圍 (包含整條路線)
        const bbox = turf.bbox(routeLine);
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { 
            padding: { left: 150, right: 150, top: 150, bottom: 150 }, 
            duration: 2500, // 飛回總覽需要 2.5 秒
            essential: true
        });

        // 2. 當地圖「飛到位置」後觸發
        map.once('moveend', () => {
            
            // 地圖停穩後，先等 0.5 秒緩衝
            setTimeout(() => {
                
                showFinalSummary(); // 【正式在畫布上顯示所有照片】
                
                // 3. 照片顯示後，如果是錄影模式，多錄幾秒再切斷
                if (isRecordingVideo && mediaRecorder && mediaRecorder.state !== 'inactive') {
                    
                    // 這裡決定「生成的影片」最後要停留多久
                    setTimeout(() => {
                        
                        mediaRecorder.stop(); // 🎬 正式停止錄影並下載
                        
                        // 👇 【關鍵新增】錄影結束後，記得把強制重繪關掉，釋放效能
                        if (repaintInterval) clearInterval(repaintInterval);
                        
                    }, 6000); // 10000 代表照片出現後，強制錄製 6 秒
                }

            }, 500); 
        });
        return;
    }
    
    animationId = requestAnimationFrame(animate);
}

playBtn.addEventListener('click', () => {
    if (!routeLine) return alert('請先上傳照片');
    
    const isStartingFromBeginning = currentDistance >= totalDistance || currentDistance === 0;

    if (isStartingFromBeginning) { 
        currentDistance = 0; 
        shownPhotos.clear(); 
        // 清空畫面上的彈出與總覽圖層
        map.getSource('active-photo').setData({ type: 'FeatureCollection', features: [] });
        map.getSource('final-photos').setData({ type: 'FeatureCollection', features: [] });
    }

    isPlaying = true;
    isPhotoPausing = false; 
    toggleButtons();

    if (isStartingFromBeginning) {
        const startCoord = routeLine.coordinates[0];
        const segConfig = getSegmentConfig(0);
        const leftPad = window.innerWidth < 800 ? 50 : 450;

        map.getSource('point').setData(turf.along(routeLine, 0, { units: 'kilometers' }));
        distanceDisplay.innerText = "0.00";

        map.flyTo({
            center: startCoord,
            zoom: segConfig.zoom,
            pitch: segConfig.pitch,
            padding: { left: leftPad },
            speed: 1.2,  
            curve: 1.4,  
            essential: true
        });

        map.once('moveend', () => {
            currentCameraZoom = map.getZoom();
            currentCameraPitch = map.getPitch();
            if (!isPlaying) return; 
            lastTime = performance.now();
            animate(lastTime);
        });

    } else {
        lastTime = performance.now();
        animate(lastTime);
    }
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

// --- 7. 下載影片功能 ---
if (downloadVideoBtn) {
    downloadVideoBtn.addEventListener('click', () => {
        if (!routeLine) return alert('請先產生路徑再錄製影片');
        if (isRecordingVideo) return; 
        startVideoRecording();
    });
}

function startVideoRecording() {
    const canvas = map.getCanvas();
    const stream = canvas.captureStream(60); 
    
    let options = { mimeType: 'video/webm; codecs=vp9' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' };
    }

    mediaRecorder = new MediaRecorder(stream, options);
    recordedChunks = [];

    mediaRecorder.ondataavailable = function(e) {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = function() {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const name = routeTitle ? routeTitle.innerText.trim() : "旅程紀錄";
        a.download = `${name}.webm`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        
        downloadVideoBtn.classList.remove('text-red-500', 'animate-pulse');
        isRecordingVideo = false;
    };

    mediaRecorder.start();
    isRecordingVideo = true;
    downloadVideoBtn.classList.add('text-red-500', 'animate-pulse');

    currentDistance = 0; 
    shownPhotos.clear(); 
    map.getSource('active-photo').setData({ type: 'FeatureCollection', features: [] });
    map.getSource('final-photos').setData({ type: 'FeatureCollection', features: [] });
    
    isPlaying = true;
    isPhotoPausing = false;
    toggleButtons();

    const startCoord = routeLine.coordinates[0];
    const segConfig = getSegmentConfig(0);
    const leftPad = window.innerWidth < 800 ? 50 : 450;

    map.getSource('point').setData(turf.along(routeLine, 0, { units: 'kilometers' }));
    distanceDisplay.innerText = "0.00";

    map.flyTo({
        center: startCoord,
        zoom: segConfig.zoom,
        pitch: segConfig.pitch,
        padding: { left: leftPad },
        speed: 1.2,
        curve: 1.4,
        essential: true
    });

    map.once('moveend', () => {
        currentCameraZoom = map.getZoom();
        currentCameraPitch = map.getPitch();
        if (!isPlaying) {
            mediaRecorder.stop();
            return; 
        }
        lastTime = performance.now();
        animate(lastTime);
    });
}