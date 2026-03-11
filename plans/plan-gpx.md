# GPX 路徑替換實作計畫（範例：`gpx/Qixingshan.gpx`）

## 1) `index.html` 現況整理

目前路線資料是**硬編碼**在 `<script>` 內：

- `const yushanWaypoints = [...]`  
  手動寫死 `[經度, 緯度, 海拔]` 陣列。
- `const fullRouteCoords = [...yushanWaypoints]` + 反向 `push`  
  產生「上山 + 原路折返」。
- `const routeLine = turf.lineString(fullRouteCoords)`  
  轉成 Turf 的 LineString。
- `const totalDistance = turf.length(routeLine, { units: 'kilometers' })`
- `const routeDistanceProfile = buildRouteDistanceProfile(fullRouteCoords)`  
  供 `getElevationAtDistance()` 與動畫顯示海拔使用。

另外，流程是直接 `initMap();`，地圖中心目前寫 `center: yushanWaypoints[0]`。

---

## 2) 替換策略（改為 GPX 載入後再計算）

目標：把「路線來源」改成 GPX，而非手寫陣列。

1. 先把 route 相關常數改成可重設的 `let`。
2. 新增 `loadRouteFromGpx(path)`：
   - `fetch(path)` 讀取 GPX
   - `DOMParser` 解析 XML
   - 抓 `trkpt` 的 `lat/lon`，與子節點 `ele`
   - 組成 `[lon, lat, ele]`
3. 在 `loadRouteFromGpx` 內重建：
   - `yushanWaypoints`
   - `fullRouteCoords`
   - `routeLine`
   - `totalDistance`
   - `routeDistanceProfile`
4. 啟動流程改成 async：
   - 先 `await loadRouteFromGpx('gpx/Qixingshan.gpx')`
   - 再 `initMap()`
5. `map` 的 `center` 改成只吃經緯度：
   - `[yushanWaypoints[0][0], yushanWaypoints[0][1]]`

---

## 3) 可直接貼上的關鍵程式片段

### 3.1 把 route 相關 `const` 改為 `let`

```js
let yushanWaypoints = [];
let fullRouteCoords = [];
let routeLine;
let totalDistance = 0;
let routeDistanceProfile = [];
```

### 3.2 新增 `loadRouteFromGpx(path)`（`fetch + DOMParser` 解析 `trkpt/ele`）

```js
async function loadRouteFromGpx(path) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`GPX 載入失敗: ${response.status} ${response.statusText}`);
    }

    const gpxText = await response.text();
    const xmlDoc = new DOMParser().parseFromString(gpxText, 'application/xml');

    if (xmlDoc.querySelector('parsererror')) {
        throw new Error('GPX XML 解析失敗');
    }

    const trkpts = Array.from(xmlDoc.getElementsByTagNameNS('*', 'trkpt'));
    const points = trkpts.map((pt) => {
        const lat = Number(pt.getAttribute('lat'));
        const lon = Number(pt.getAttribute('lon'));
        const eleNode = pt.getElementsByTagNameNS('*', 'ele')[0];
        const ele = eleNode ? Number(eleNode.textContent) : 0;

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return [lon, lat, Number.isFinite(ele) ? ele : 0];
    }).filter(Boolean);

    if (points.length < 2) {
        throw new Error('GPX trkpt 不足，至少需要 2 個點');
    }

    yushanWaypoints = points;

    // 若要保留原本「去回程」效果，保留下面這段；只要單程就改成 fullRouteCoords = [...yushanWaypoints]
    fullRouteCoords = [...yushanWaypoints];
    for (let i = yushanWaypoints.length - 2; i >= 0; i--) {
        fullRouteCoords.push(yushanWaypoints[i]);
    }

    routeLine = turf.lineString(fullRouteCoords);
    totalDistance = turf.length(routeLine, { units: 'kilometers' });
    routeDistanceProfile = buildRouteDistanceProfile(fullRouteCoords);
}
```

### 3.3 啟動流程改為 async（先載 GPX，再初始化地圖）

```js
(async function bootstrap() {
    try {
        await loadRouteFromGpx('gpx/Qixingshan.gpx');
        initMap();
    } catch (err) {
        console.error('初始化失敗:', err);
        alert(`無法載入 GPX：${err.message}`);
    }
})();
```

### 3.4 `center` 改用純經緯度

```js
center: [yushanWaypoints[0][0], yushanWaypoints[0][1]],
```

---

## 4) 路徑寫法（務必注意）

- ✅ 正確：`gpx/Qixingshan.gpx`
- ❌ 錯誤：`gpx\\Qixingshan.gpx`（URL 不能用反斜線）

---

## 5) 執行注意事項

`fetch('gpx/Qixingshan.gpx')` 必須透過 HTTP server，**不能**直接用 `file://` 開 `index.html`。

範例（在專案根目錄執行）：

```bash
python -m http.server 5500
```

然後開啟：`http://localhost:5500/index.html`

---

## 6) 最小驗證清單

- [ ] 頁面載入後，Console 沒有 GPX 解析錯誤。
- [ ] 地圖有顯示路線（`route-line`）。
- [ ] 播放後 marker 能沿路線移動，距離數字持續增加。
- [ ] 海拔顯示會隨進度變化（非固定值）。
- [ ] Console 無 CORS / `Failed to fetch` / `file://` 相關錯誤。

