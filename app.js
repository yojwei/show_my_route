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
let photoDisplayPoints = [];
let finalPopups = []; 

// --- DOM 元件 ---
const photoCard = document.getElementById('photo-card');
const photoCardImg = document.getElementById('photo-card-img');
const photoCardLabel = document.getElementById('photo-card-label');
const distanceDisplay = document.getElementById('distance-display');
const elevationDisplay = document.getElementById('elevation-display');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const routeTitle = document.getElementById('route-title');

// --- 工具函數: HTML 轉義 ---
const escHtml = (str) => {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

// --- 1. 地圖初始化 ---
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
      layers: [
        { id: 'satellite-layer', type: 'raster', source: 'satellite', paint: { 'raster-saturation': 0.2 } }
      ],
      terrain: { source: 'terrain-source', exaggeration: 1.5 }
    },
    center: [120.9738, 23.9756],
    zoom: 6,
    pitch: 0,
    bearing: 0
  });

  map.on('load', () => {
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({
      id: 'route-preview',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] }
    });

    map.addSource('route-progress', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({
      id: 'route-progress',
      type: 'line',
      source: 'route-progress',
      paint: { 'line-color': '#3b82f6', 'line-width': 6, 'line-opacity': 1, 'line-cap': 'round', 'line-join': 'round' }
    });

    map.addSource('point', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [] } } });
    map.addLayer({
      id: 'point-circle',
      type: 'circle',
      source: 'point',
      paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#3b82f6' }
    });

    map.addSource('photos', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true, clusterMaxZoom: 14, clusterRadius: 50
    });

    map.addLayer({
      id: 'photo-clusters',
      type: 'circle',
      source: 'photos',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['step', ['get', 'point_count'], '#3b82f6', 10, '#f59e0b', 30, '#ef4444'],
        'circle-radius': ['step', ['get', 'point_count'], 20, 10, 30, 30, 40],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff'
      }
    });

    map.addLayer({
      id: 'photo-cluster-count',
      type: 'symbol',
      source: 'photos',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 13,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
      },
      paint: { 'text-color': '#fff' }
    });

    map.addLayer({
      id: 'photo-markers',
      type: 'circle',
      source: 'photos',
      filter: ['!', ['has', 'point_count']],
      paint: { 'circle-radius': 9, 'circle-color': '#bfdbfe', 'circle-stroke-width': 2, 'circle-stroke-color': '#60a5fa' }
    });

    // 叢集點擊事件
    const expandCluster = async (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['photo-clusters'] });
      if (!features.length) return;
      const clusterId = features[0].properties.cluster_id;
      const zoom = await map.getSource('photos').getClusterExpansionZoom(clusterId);
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    };
    map.on('click', 'photo-clusters', expandCluster);
  });
}

// --- 2. 照片上傳處理 ---
const uploadInput = document.getElementById('photo-upload');

if (uploadInput) {
  uploadInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const toDec = (dms, ref) => {
      let dec = dms[0] + dms[1] / 60 + dms[2] / 3600;
      return (ref === 'S' || ref === 'W') ? -dec : dec;
    };

    const metadata = await Promise.all(
      files.map(file => {
        return new Promise(resolve => {
          EXIF.getData(file, function () {
            const lat = EXIF.getTag(this, 'GPSLatitude');
            const lon = EXIF.getTag(this, 'GPSLongitude');
            const latRef = EXIF.getTag(this, 'GPSLatitudeRef') || 'N';
            const lonRef = EXIF.getTag(this, 'GPSLongitudeRef') || 'E';
            const alt = EXIF.getTag(this, 'GPSAltitude');
            const altitudeValue = alt ? (alt.numerator / alt.denominator || parseFloat(alt)) : 0;
            const date = EXIF.getTag(this, 'DateTimeOriginal');
            const formattedDate = date ? date.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1/$2/$3') : null;

            resolve({
              coords: (lat && lon) ? [toDec(lon, lonRef), toDec(lat, latRef)] : null,
              altitude: altitudeValue,
              time: formattedDate,
              file,
              name: file.name
            });
          });
        });
      })
    );

    // 重置狀態
    if (activePopup) activePopup.remove();
    finalPopups.forEach(p => p.remove());
    finalPopups = [];
    photoFeatures.forEach(f => URL.revokeObjectURL(f.properties.objectUrl));
    photoFeatures = [];
    shownPhotos.clear();

    metadata.forEach((m, i) => {
      if (!m.coords) {
        noGpsPhotos.push({ name: m.name, time: m.time });
        return;
      }
      const objectUrl = URL.createObjectURL(m.file);
      photoFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: m.coords },
        properties: {
          id: `photo-${i}-${Date.now()}`,
          name: m.name,
          time: m.time,
          altitude: m.altitude,
          objectUrl: objectUrl
        }
      });
    });

    // 依時間排序
    photoFeatures.sort((a, b) => new Date(a.properties.time) - new Date(b.properties.time));

    const photosSource = map?.getSource('photos');
    if (photosSource) photosSource.setData({ type: 'FeatureCollection', features: photoFeatures });

    // 更新路徑 (串接 OSRM)
    const coords = photoFeatures.map(f => f.geometry.coordinates);
    if (coords.length >= 2) {
      await updateRoute(coords);
    }
    
    e.target.value = '';
  });
}

// --- 3. 路徑與動畫邏輯 ---

async function updateRoute(coords) {
  const pointsStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${pointsStr}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.code !== 'Ok') throw new Error('OSRM Error');

    routeLine = data.routes[0].geometry;
    totalDistance = turf.length(routeLine, { units: 'kilometers' });
    currentDistance = 0;
    isPlaying = false;
    toggleButtons();

    map?.getSource('route')?.setData(routeLine);
    map?.getSource('route-progress')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    map?.getSource('point')?.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: routeLine.coordinates[0] } });

    const bbox = turf.bbox(routeLine);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 80, bottom: 80, left: 420, right: 80 },
      duration: 2000
    });
    document.getElementById('route-subtitle').innerText = `包含 ${coords.length} 個地標 (已規劃道路)`;
  } catch (err) {
    console.error("Using Fallback Line:", err);
    routeLine = turf.lineString(coords);
    totalDistance = turf.length(routeLine, { units: 'kilometers' });
    map?.getSource('route')?.setData(routeLine);
  }
}

function updateDisplay(dist) {
  const point = turf.along(routeLine, dist, { units: 'kilometers' });
  const coords = point.geometry.coordinates;

  const progressLine = turf.lineSlice(turf.point(routeLine.coordinates[0]), point, routeLine);
  map?.getSource('route-progress')?.setData(progressLine);
  map?.getSource('point')?.setData(point);
  distanceDisplay.innerText = dist.toFixed(2);

  // 海拔修正：從地圖地形獲取
  const terrainAlt = map.queryTerrainElevation(coords);
  if (elevationDisplay) {
    elevationDisplay.innerText = (terrainAlt !== null) ? Math.floor(terrainAlt) : '0';
  }

  // 觸發照片卡片
  photoFeatures.forEach((f, i) => {
    if (!shownPhotos.has(f.properties.id)) {
      const d = turf.distance(point, f, { units: 'kilometers' });
      if (d < 0.15) {
        shownPhotos.add(f.properties.id);
        showPhotoCard(f, i);
      }
    }
  });

  map.easeTo({
    center: coords,
    padding: { left: 350, right: 0, top: 0, bottom: 0 },
    zoom: 15.5, pitch: 65, duration: 100
  });
}

function showPhotoCard(feature, index) {
  photoCardImg.src = feature.properties.objectUrl;
  photoCardLabel.textContent = `照片 #${index + 1} · ${feature.properties.time || '時間不明'}`;
  photoCard.classList.remove('hidden');
  if (photoCardTimeout) clearTimeout(photoCardTimeout);
  photoCardTimeout = setTimeout(() => photoCard.classList.add('hidden'), 3500);
}

function animate(timestamp) {
  if (!isPlaying) return;
  if (!lastTime) lastTime = timestamp;
  const delta = timestamp - lastTime;
  lastTime = timestamp;

  const speed = (1 / 1000) * playbackSpeed;
  currentDistance += speed * delta;

  if (currentDistance >= totalDistance) {
    currentDistance = totalDistance;
    isPlaying = false;
    toggleButtons();
    updateDisplay(currentDistance);
    setTimeout(showFinalSummary, 800);
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
  }
  isPlaying = true;
  lastTime = 0;
  toggleButtons();
  animate(performance.now());
});

pauseBtn.addEventListener('click', () => {
  isPlaying = false;
  toggleButtons();
});

function toggleButtons() {
  playBtn.classList.toggle('hidden', isPlaying);
  pauseBtn.classList.toggle('hidden', !isPlaying);
}

function showFinalSummary() {
  if (photoFeatures.length === 0) return;
  finalPopups.forEach(p => p.remove());
  finalPopups = [];

  photoFeatures.forEach((f) => {
    const offsetCoords = getOffsetPhotoPosition(map, f.geometry.coordinates);
    const popup = new maplibregl.Popup({ 
      closeButton: false, closeOnClick: false, maxWidth: '120px', offset: [0, -10], className: 'final-summary-popup'
    })
      .setLngLat(offsetCoords)
      .setHTML(`<div style="border: 2px solid white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                  <img src="${f.properties.objectUrl}" style="width: 100%; display: block; object-fit: cover; height: 80px;">
                </div>`)
      .addTo(map);
    finalPopups.push(popup);
  });

  const bbox = turf.bbox(routeLine);
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
    padding: { top: 100, bottom: 100, left: 200, right: 100 }, 
    duration: 2500, pitch: 0, bearing: 0, essential: true
  });
}

// [關鍵修改] 讓海拔隨地形即時跳動
function updateDisplay(dist) {
  const point = turf.along(routeLine, dist, { units: 'kilometers' });
  const coords = point.geometry.coordinates;

  // 更新路徑與小藍點位置
  const progressLine = turf.lineSlice(turf.point(routeLine.coordinates[0]), point, routeLine);
  map?.getSource('route-progress')?.setData(progressLine);
  map?.getSource('point')?.setData(point);
  distanceDisplay.innerText = dist.toFixed(2);

  // --- 海拔顯示修正：改用 MapLibre Terrain 數據 ---
  const terrainAlt = map.queryTerrainElevation(coords);
  
  if (elevationDisplay) {
    if (terrainAlt !== null && !isNaN(terrainAlt)) {
      elevationDisplay.innerText = Math.floor(terrainAlt); // 隨地形即時跳動
    } else {
      // 備案：若地形未載入，抓最近的照片高度
      let minD = Infinity, closestAlt = 0;
      photoFeatures.forEach(f => {
        const d = turf.distance(point, f);
        if (d < minD) { minD = d; closestAlt = f.properties.altitude; }
      });
      elevationDisplay.innerText = Math.floor(closestAlt || 0);
    }
  }

  // 照片彈出偵測
  photoFeatures.forEach((f, i) => {
    if (!shownPhotos.has(f.properties.id)) {
      const d = turf.distance(point, f, { units: 'kilometers' });
      if (d < 0.15) {
        shownPhotos.add(f.properties.id);
        showPhotoCard(f, i);
      }
    }
  });

  map.easeTo({
    center: coords,
    padding: { left: 350, right: 0, top: 0, bottom: 0 },
    zoom: 15.5, pitch: 65, duration: 100
  });
}

function animate(timestamp) {
  if (!isPlaying) { animationId = null; return; }
  if (!lastTime) lastTime = timestamp;
  const delta = timestamp - lastTime;
  lastTime = timestamp;

  if (!routeLine) return;
  const speed = (1 / 1000) * playbackSpeed;
  currentDistance += speed * delta;

  if (currentDistance >= totalDistance) {
    currentDistance = totalDistance;
    isPlaying = false;
    toggleButtons();
    updateDisplay(currentDistance);
    setTimeout(showFinalSummary, 800); 
    return;
  }

  updateDisplay(currentDistance);
  animationId = requestAnimationFrame(animate);
}

playBtn.addEventListener('click', () => {
  if (!routeLine) return alert('請先上傳照片');
  
  finalPopups.forEach(p => p.remove());
  finalPopups = [];

  if (currentDistance >= totalDistance) {
    currentDistance = 0;
    shownPhotos.clear();
  }
  isPlaying = true;
  lastTime = 0;
  toggleButtons();
  if (!animationId) animationId = requestAnimationFrame(animate);
});

pauseBtn.addEventListener('click', () => {
  isPlaying = false;
  toggleButtons();
  if (animationId) cancelAnimationFrame(animationId);
});

function toggleButtons() {
  playBtn.classList.toggle('hidden', isPlaying);
  pauseBtn.classList.toggle('hidden', !isPlaying);
}

// 截圖下載邏輯 (省略...保持與原程式碼一致)
function formatDateSlash(date) {
    if (!date) return "";
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}/${m}/${d}`;
}

async function drawImageFromUrl(ctx, url, x, y, w, h) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            ctx.drawImage(img, x, y, w, h);
            resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
    });
}

function getNonOverlappingPhotoPositions(map, points) {
    const placed = [];
    const size = 60;
    for (const p of points) {
        const proj = map.project([p.lon, p.lat]);
        let x = Math.round(proj.x - size / 2);
        let y = Math.round(proj.y - size / 2);
        placed.push({ x, y, objectUrl: p.objectUrl });
    }
    return placed;
}

document.getElementById('share-btn').addEventListener('click', async () => {
    try {
        const mapCanvas = map.getCanvas();
        const shareCanvas = document.createElement('canvas');
        shareCanvas.width = mapCanvas.width;
        shareCanvas.height = mapCanvas.height;
        const ctx = shareCanvas.getContext('2d');

        ctx.drawImage(mapCanvas, 0, 0);

        const displayPoints = getNonOverlappingPhotoPositions(map, photoDisplayPoints);
        for (const p of displayPoints) {
            ctx.save();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 3;
            await drawImageFromUrl(ctx, p.objectUrl, p.x, p.y, 60, 60);
            ctx.strokeRect(p.x, p.y, 60, 60);
            ctx.restore();
        }

        const routeName = routeTitle.innerText.trim() || "我的路徑";
        const dateText = (photoDateRange.min) ? `${formatDateSlash(photoDateRange.min)} - ${formatDateSlash(photoDateRange.max)}` : "日期不明";
        
        ctx.fillStyle = "white";
        ctx.shadowColor = "black";
        ctx.shadowBlur = 8;
        ctx.textAlign = "right";
        ctx.font = "bold 30px sans-serif";
        ctx.fillText(routeName, shareCanvas.width - 30, shareCanvas.height - 70);
        ctx.font = "20px sans-serif";
        ctx.fillText(dateText, shareCanvas.width - 30, shareCanvas.height - 35);

        const dataUrl = shareCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `${routeName}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        console.error(e);
        alert("下載失敗");
    }
});