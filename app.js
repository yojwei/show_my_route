// --- 全域變數定義 ---
let map, animationId;
let routeLine, totalDistance, routeDistanceProfile;
let currentDistance = 0, isPlaying = false, lastTime = 0;
const animationDuration = 40000;

// DOM 元素
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');

// --- 檔案處理與 EXIF 解析 ---
document.getElementById('photo-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    const points = [];

    for (let file of files) {
        try {
            const exif = await exifr.parse(file);
            if (exif.latitude && exif.longitude) {
                points.push({
                    coords: [exif.longitude, exif.latitude, exif.altitude || 0],
                    time: exif.DateTimeOriginal || new Date(0)
                });
            }
        } catch (err) { console.error("解析照片失敗:", err); }
    }

    // 依時間排序並提取座標
    points.sort((a, b) => a.time - b.time);
    const waypoints = points.map(p => p.coords);
    
    // 建立來回軌跡
    const fullCoords = [...waypoints, ...waypoints.slice(0, -1).reverse()];
    updateMapData(fullCoords);
});

// --- 更新地圖與計算邏輯 ---
function updateMapData(coords) {
    routeLine = turf.lineString(coords);
    totalDistance = turf.length(routeLine, { units: 'kilometers' });
    routeDistanceProfile = buildRouteDistanceProfile(coords);
    currentDistance = 0;

    if (!map) {
        initMap(coords[0]);
    } else {
        map.getSource('route').setData(routeLine);
        map.getSource('point').setData(turf.point(coords[0]));
        map.flyTo({ center: coords[0], zoom: 14 });
    }
}

function buildRouteDistanceProfile(coords) {
    const profile = [{ distance: 0, elevation: coords[0][2] ?? 0 }];
    let accumulatedDistance = 0;
    for (let i = 1; i < coords.length; i++) {
        const segmentDistance = turf.distance(turf.point(coords[i - 1]), turf.point(coords[i]), { units: 'kilometers' });
        accumulatedDistance += segmentDistance;
        profile.push({ distance: accumulatedDistance, elevation: coords[i][2] ?? profile[profile.length - 1].elevation });
    }
    return profile;
}

function getElevationAtDistance(distanceKm) {
    if (distanceKm <= 0) return routeDistanceProfile[0].elevation;
    const lastPoint = routeDistanceProfile[routeDistanceProfile.length - 1];
    if (distanceKm >= lastPoint.distance) return lastPoint.elevation;
    for (let i = 1; i < routeDistanceProfile.length; i++) {
        const previousPoint = routeDistanceProfile[i - 1];
        const nextPoint = routeDistanceProfile[i];
        if (distanceKm <= nextPoint.distance) {
            const segmentDistance = nextPoint.distance - previousPoint.distance;
            if (segmentDistance === 0) return nextPoint.elevation;
            const ratio = (distanceKm - previousPoint.distance) / segmentDistance;
            return previousPoint.elevation + (nextPoint.elevation - previousPoint.elevation) * ratio;
        }
    }
    return lastPoint.elevation;
}

function initMap(center) {
    map = new maplibregl.Map({
        container: 'map',
        style: { /* ...同原設定... */ },
        center: center,
        zoom: 13, pitch: 60, bearing: 150
    });
    
    map.on('load', () => {
        map.addSource('route', { 'type': 'geojson', 'data': routeLine });
        map.addLayer({ 'id': 'route-line', 'type': 'line', 'source': 'route', /* ...樣式同原設定... */ });
        map.addSource('point', { 'type': 'geojson', 'data': turf.point(center) });
        map.addLayer({ 'id': 'point-circle', 'type': 'circle', 'source': 'point', /* ...樣式同原設定... */ });
    });
}

function animateMarker(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    if (isPlaying) {
        currentDistance += (totalDistance / animationDuration) * deltaTime;
        if (currentDistance >= totalDistance) { currentDistance = totalDistance; isPlaying = false; toggleButtons(); }
        const currentPoint = turf.along(routeLine, currentDistance, { units: 'kilometers' });
        const lookAhead = turf.along(routeLine, Math.min(currentDistance + 0.5, totalDistance), { units: 'kilometers' });
        map.getSource('point').setData(currentPoint);
        distanceDisplay.textContent = currentDistance.toFixed(1);
        elevationDisplay.textContent = Math.floor(getElevationAtDistance(currentDistance));
        map.jumpTo({ center: currentPoint.geometry.coordinates, zoom: 13.5, pitch: 65, bearing: turf.bearing(currentPoint, lookAhead) });
    }
    animationId = requestAnimationFrame(animateMarker);
}

function toggleButtons() {
    playBtn.classList.toggle('hidden', isPlaying);
    pauseBtn.classList.toggle('hidden', !isPlaying);
}

playBtn.addEventListener('click', () => {
    if (currentDistance >= totalDistance) currentDistance = 0;
    isPlaying = true;
    lastTime = performance.now();
    toggleButtons();
    cancelAnimationFrame(animationId);
    animateMarker(performance.now());
});

pauseBtn.addEventListener('click', () => { isPlaying = false; toggleButtons(); });

initMap();