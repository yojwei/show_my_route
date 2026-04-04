# 照片地圖標記實作計畫（plan-map）

> **狀態**：✅ 已完成  
> **進度**：Phase 0~7 全部完成，並已完成驗證。

## 1. 背景與目標

### 背景
目前工具（`index.html` 內嵌腳本）已具備照片上傳與 EXIF 解析流程：上傳照片後擷取 GPS + 時間，排序後以 Turf.js 建立路線並播放 3D 動畫。然而照片本身在地圖上毫無視覺呈現——使用者看不出「哪張照片在哪裡拍」。

### 目標
- 在地圖上以 **GeoJSON source + symbol layer** 渲染每張照片的拍攝位置。
- 照片密集時自動聚合（cluster），避免大量 DOM marker 拖慢效能。
- 點擊 marker / cluster 展開後，彈出含縮圖與基本 EXIF 資訊的 Popup。
- 妥善處理缺少 GPS 或時間的照片（跳過路線但仍可選擇性顯示）。

---

## 2. 現況分析

### 執行路徑
- **`index.html` 內嵌 `<script>`** 是唯一執行中的 runtime；`app.js` 未被 `index.html` 引用，屬開發草稿。
- 所有修改必須針對 `index.html` 的內嵌腳本進行。

### 照片上傳現有流程（`index.html` 第 166–200 行）
```
上傳 → EXIF.getData → 解析 GPS + DateTimeOriginal
→ 過濾掉無 GPS 或無時間的項目
→ 依時間排序 → 僅取 coords 陣列 → updateRoute(coords)
```
**問題**：
1. 無 GPS 的照片直接 `resolve(null)` 被丟棄，目前連記錄都沒有。
2. 無時間的照片也被過濾；若有 GPS 但無時間，目前亦無法加入路線。
3. 原始 `File` 物件未保留，無法後續產生縮圖。

### 地圖層結構
| source id | type | 用途 |
|---|---|---|
| `route` | geojson LineString | 路線 |
| `point` | geojson Point | 移動中的位置圓點 |

### 已載入函式庫
| 函式庫 | 版本 | CDN |
|---|---|---|
| MapLibre GL JS | 3.6.2（後載蓋前） | unpkg |
| Turf.js | 6.x | jsdelivr |
| EXIF.js | latest | jsdelivr |

---

## 3. 功能範圍

### In Scope
- 解析每張照片的 EXIF（GPS、時間、原始 `File`）並保留完整物件陣列。
- 以 GeoJSON FeatureCollection + MapLibre `cluster: true` source 渲染照片標記。
- Cluster 圓圈顯示聚合數量；單一 marker 顯示相機圖示或縮圖圓形。
- 點擊 cluster → 地圖縮放至該群組範圍。
- 點擊單一 marker → 彈出 Popup，顯示縮圖（`URL.createObjectURL`）、檔名、日期時間。
- 缺少 GPS 的照片：加入側邊「無定位清單」，不上地圖但不靜默丟棄。
- 缺少時間的照片：若有 GPS 仍可上地圖（排序時排至最後）。
- 上傳新一批照片時正確清除舊 source/layer 資料（不重建 map）。

### Out of Scope（本次不做）
- 照片的完整 EXIF sidebar（光圈、快門、ISO 等）。
- Drag-and-drop 批次重新排序。
- 照片刪除 / 重新選擇個別項目。
- 後端儲存或分享照片連結。
- GPX 與照片的時間比對配對（已有 plan-gpx.md）。

---

## 4. 技術方案

### 4.1 資料模型

在全域新增一個照片資料陣列（取代原本僅保留 coords 的做法）：

```js
// 全域
let photoFeatures = []; // GeoJSON Feature[]，每張照片一筆
let noGpsPhotos = [];   // { file, name, time } 無法定位的照片
```

每個 `Feature` 結構：
```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [lon, lat] },
  "properties": {
    "id": "photo-0",
    "name": "IMG_1234.jpg",
    "time": "2024/06/01 10:23:45",
    "objectUrl": "blob:..."   // URL.createObjectURL(file)
  }
}
```

> `objectUrl` 在頁面生命週期內有效；重新上傳時需先 `URL.revokeObjectURL` 釋放舊 URL。

### 4.2 地圖 Source / Layer 設計

在 `map.on('load', ...)` 中新增：

```js
// Source：啟用 cluster
map.addSource('photos', {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
  cluster: true,
  clusterMaxZoom: 14,
  clusterRadius: 50
});

// Layer 1：cluster 圓圈
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

// Layer 2：cluster 數字標籤
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

// Layer 3：單一照片 marker（未聚合）
map.addLayer({
  id: 'photo-markers',
  type: 'circle',
  source: 'photos',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-radius': 10,
    'circle-color': '#fff',
    'circle-stroke-width': 3,
    'circle-stroke-color': '#3b82f6'
  }
});
```

> **為何選 source/layer 而非 `maplibregl.Marker`**：
> - MapLibre Marker 每個是獨立 DOM 元素，照片多時（數十至數百張）會造成 DOM 膨脹與 reflow 效能問題。
> - GeoJSON source 支援原生 cluster，僅需一個 canvas draw call，效能遠優於大量 DOM marker。
> - cluster 展開行為由 MapLibre 原生處理，不需手動計算。

### 4.3 Marker + Cluster + Popup 互動

**點擊 cluster → 縮放展開**：
```js
// MapLibre v3.x 的 getClusterExpansionZoom 回傳 Promise，不再使用 callback
map.on('click', 'photo-clusters', async (e) => {
  const features = map.queryRenderedFeatures(e.point, { layers: ['photo-clusters'] });
  const clusterId = features[0].properties.cluster_id;
  try {
    const zoom = await map.getSource('photos').getClusterExpansionZoom(clusterId);
    map.easeTo({ center: features[0].geometry.coordinates, zoom });
  } catch (_) {}
});
```

**點擊單一 marker → Popup 縮圖**：
```js
map.on('click', 'photo-markers', (e) => {
  const props = e.features[0].properties;
  const coords = e.features[0].geometry.coordinates.slice();
  new maplibregl.Popup({ maxWidth: '220px' })
    .setLngLat(coords)
    .setHTML(`
      <div style="text-align:center">
        <img src="${props.objectUrl}" style="width:200px;height:150px;object-fit:cover;border-radius:6px;margin-bottom:6px">
        <div style="font-size:11px;color:#ccc">${props.name}</div>
        <div style="font-size:11px;color:#9ca3af">${props.time || '時間不明'}</div>
      </div>
    `)
    .addTo(map);
});
```

**滑鼠游標樣式**：
```js
map.on('mouseenter', 'photo-clusters', () => map.getCanvas().style.cursor = 'pointer');
map.on('mouseleave', 'photo-clusters', () => map.getCanvas().style.cursor = '');
map.on('mouseenter', 'photo-markers', () => map.getCanvas().style.cursor = 'pointer');
map.on('mouseleave', 'photo-markers', () => map.getCanvas().style.cursor = '');
```

### 4.4 EXIF 缺失處理策略

| 情況 | 處理方式 |
|---|---|
| 有 GPS、有時間 | 正常加入路線 + 加入 map marker |
| 有 GPS、**無時間** | 加入 map marker，排序時置後（`time = null`，排序鍵用 `Infinity`） |
| **無 GPS**、有時間 | 加入 `noGpsPhotos`，顯示於無定位清單，不上地圖 |
| 無 GPS、無時間 | 加入 `noGpsPhotos`，顯示名稱提醒使用者 |

無定位清單 UI（已存在的 `#route-subtitle` 下方，或新增小提示）：
```
⚠ 3 張照片無 GPS 資訊，未顯示於地圖：IMG_A.jpg, IMG_B.jpg, IMG_C.jpg
```

---

## 5. 具體實作步驟

### Phase 0：前置準備（不改現有邏輯，僅擴充）

- [x] 在全域宣告區新增 `photoFeatures = []` 與 `noGpsPhotos = []`。
- [x] 在 `map.on('load', ...)` 結尾新增 `photos` source 與三個 layer（clusters / count / markers）。
- [x] 確認 MapLibre 版本衝突：移除 `index.html` 第 7–8 行重複引用的 v2.4.0（保留 v3.6.2）；確認 `cluster` API 在 3.6.2 正常可用（已驗証支援）。

### Phase 1：擴充 EXIF 解析，保留 File 物件

改寫 `photo-upload` 的 `change` handler，需同時移除兩處舊的早期回傳守衛：
1. `if (files.length < 2) return alert(...)` → 改為 `if (files.length === 0) return`；一張照片若有 GPS 即可顯示於地圖（路線需兩點才繪製，由 Phase 4 的 `sortedPoints.length >= 2` 判斷即可）。
2. `if (sortedPoints.length < 2) return alert(...)` → **完全移除**；Phase 3–5 已能優雅處理零或一個有效點的情況（地圖顯示已有的 marker、路線不繪製、警告文字提示）。

接著改寫 metadata 解析 Promise：

```js
// 原本只回傳 { coords, time }
// 改為回傳 { coords, time, file, name }，coords 可為 null
const metadata = await Promise.all(files.map(file => {
  return new Promise(resolve => {
    EXIF.getData(file, function() {
      // ... 解析 GPS、time（保持現有 toDec 邏輯）
      resolve({
        coords: (lat && lon) ? [toDec(lon, lonRef), toDec(lat, latRef)] : null,
        time: formattedDate || null,
        file,
        name: file.name
      });
    });
  });
}));
```

### Phase 2：分流建立 photoFeatures / noGpsPhotos

```js
// 釋放舊 objectUrl，避免記憶體洩漏
photoFeatures.forEach(f => URL.revokeObjectURL(f.properties.objectUrl));
photoFeatures = [];
noGpsPhotos = [];

metadata.forEach((m, i) => {
  if (!m.coords) {
    noGpsPhotos.push({ name: m.name, time: m.time });
    return;
  }
  photoFeatures.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: m.coords },
    properties: {
      id: `photo-${i}`,
      name: m.name,
      time: m.time,
      objectUrl: URL.createObjectURL(m.file)
    }
  });
});
```

### Phase 3：更新 source 資料 + 渲染 markers

```js
map.getSource('photos').setData({
  type: 'FeatureCollection',
  features: photoFeatures
});
```

### Phase 4：更新路線邏輯（調整過濾與排序）

```js
// 有 GPS 的，排序（無 time 置後）
const sortedPoints = photoFeatures
  .map(f => ({ coords: f.geometry.coordinates, time: f.properties.time }))
  .sort((a, b) => {
    if (!a.time) return 1;
    if (!b.time) return -1;
    return new Date(a.time) - new Date(b.time);
  });

if (sortedPoints.length >= 2) updateRoute(sortedPoints.map(p => p.coords));
```

### Phase 5：新增無定位清單提示 UI

```js
// 在 updateRoute 之後顯示警告
const noGpsWarning = document.getElementById('no-gps-warning') || (() => {
  const el = document.createElement('p');
  el.id = 'no-gps-warning';
  el.className = 'text-xs text-yellow-400 mt-2';
  document.getElementById('route-subtitle').after(el);
  return el;
})();

noGpsWarning.textContent = noGpsPhotos.length > 0
  ? `⚠ ${noGpsPhotos.length} 張無 GPS：${noGpsPhotos.map(p => p.name).join('、')}`
  : '';
```

### Phase 6：掛載 click / hover 事件

在 `map.on('load', ...)` 結尾或其後，依序加入 cluster 點擊展開、marker 點擊 Popup、游標樣式事件（見第 4.3 節程式碼）。

### Phase 7：回歸驗證

執行第 7 節手動測試案例，確認現有路線動畫、播放控制、截圖等功能無回退。

---

## 6. 風險與對策

| 風險 | 機率 | 衝擊 | 對策 |
|---|---|---|---|
| MapLibre v2.4.0 與 v3.6.2 雙重載入衝突導致 `cluster` API 無法預期 | 高（目前已存在） | 高 | Phase 0 先移除 v2.4.0，保留 v3.6.2 單一版本 |
| `objectUrl` 累積造成記憶體洩漏（每次上傳不釋放舊 URL） | 中 | 中 | Phase 2 於重新上傳前先 `revokeObjectURL` 全部舊 feature |
| Popup 內嵌 `blob:` URL 在某些 CSP 設定下被阻擋 | 低（純本地 HTML） | 低 | 目前無 CSP 限制；若日後部署需在 HTTP header 加 `blob:` 白名單 |
| 照片數量極多（>500張）cluster 展開後仍大量 feature 造成 canvas 壓力 | 低（一般使用） | 中 | 設定合理 `clusterMaxZoom: 14`；若需可加 `maxzoom` 限制 source 精度 |
| 現有路線動畫在 `photos` source 更新後觸發不必要的 rerender | 低 | 低 | source 互相獨立；`photos` 更新不影響 `route`/`point` source |
| 無時間照片排序置後造成路線與實際行進順序不符 | 中 | 中 | UI 中明確提示「部分照片無時間，排至末端」，路線供參考而非精確 |

---

## 7. 驗證計畫（手動測試案例）

### TC-01：正常流程（全部有 GPS + 時間）
1. 上傳 5 張含 GPS 與時間的 JPEG。
2. **預期**：路線依時間順序繪製；地圖顯示 5 個 marker；`#route-subtitle` 顯示「包含 5 個點位」；無警告訊息。

### TC-02：Cluster 合併
1. 上傳 20 張 GPS 座標密集（同一山頭）的照片，縮放至 zoom 10。
2. **預期**：marker 聚合顯示數字（如「20」）；顏色正確（依 step 規則）；點擊 cluster 後地圖放大展開；zoom 14 以上顯示個別 marker。

### TC-03：單一 marker Popup
1. 縮放至可見個別 marker，點擊其中一個。
2. **預期**：Popup 顯示照片縮圖（200×150px）、檔名、拍攝時間；Popup 可關閉。

### TC-04：缺少 GPS
1. 上傳 3 張有 GPS 的照片 + 2 張無 GPS 的照片。
2. **預期**：地圖顯示 3 個 marker；路線依 3 個有效點繪製；警告文字「⚠ 2 張無 GPS：XXX.jpg、YYY.jpg」出現。

### TC-05：缺少時間
1. 上傳 2 張有 GPS + 時間的照片 + 1 張有 GPS 但無時間的照片。
2. **預期**：3 個 marker 都顯示；無時間照片排序至末端；Popup 中時間欄顯示「時間不明」；路線正常繪製。

### TC-06：全部無 GPS
1. 上傳 3 張均無 GPS 的照片。
2. **預期**：地圖無 marker；`updateRoute` 因不足 2 個點而顯示原有提示；警告文字列出 3 張照片；應用程式不 crash。

### TC-07：重複上傳清除舊資料
1. 先上傳一批照片（5 張有 GPS）。
2. 再上傳另一批照片（3 張有 GPS）。
3. **預期**：地圖僅顯示第二批的 3 個 marker（舊 marker 清除）；舊 `objectUrl` 已釋放（可透過 DevTools Memory 驗證）。

### TC-08：現有功能回歸
1. 上傳照片 → 按播放 → 確認路線動畫正常運行。
2. 播放途中點擊 marker → Popup 正確開啟，動畫不中斷。
3. 截圖按鈕 → 確認 canvas 仍可輸出。
4. 2D/3D 切換 → marker 層維持可見。

---

## 8. 後續擴充建議

1. **照片 Sidebar / 時間軸**：在右側新增縮圖列表，滾動至某張照片時地圖 flyTo 其座標；配合動畫播放高亮對應的照片。

2. **動畫與照片聯動**：播放時，當前時間點對應照片 marker 自動高亮（circle-stroke-color 變色）；移動至照片位置時自動彈出 Popup。

3. **EXIF 完整顯示**：Popup 增加摺疊區塊，顯示焦距、光圈、快門、ISO 等完整 EXIF 資訊。

4. **自訂 marker 圖示（sprite）**：使用 `map.loadImage` + `map.addImage` 搭配 symbol layer，以相機 icon 取代預設圓圈，提升視覺辨識度。

5. **GPX 與照片時間比對**：結合 `plan-gpx.md` 已規劃的 GPX 載入，依照片時間在 GPX 軌跡上插值定位，提升無準確 GPS tag 照片的定位精度。

6. **照片匯出功能**：截圖時同時將地圖標記位置與縮圖合成至輸出圖片（canvas drawImage）。
