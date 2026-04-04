# 近期修正與研究紀錄（GPX 路線顯示）

## 修正清單（已落地）

- **GPX 載入與路線資料來源改造**：以 `loadRouteFromGpx('gpx/Qixingshan.gpx')` 解析 `trkpt`，重建 `yushanWaypoints`、`fullRouteCoords`、`routeLine`、`totalDistance`、`routeDistanceProfile`。  
- **播放防呆**：加入播放前可用性檢查、動畫幀前置驗證與 `stopAnimationWithError` 中止機制，避免 `coord is required` 擴散。  
- **標題/描述改為 GPX 欄位**：`#route-title` 優先使用 `trk/name`，`#route-description` 優先使用 `metadata/time`。  
- **時間格式化**：`metadata/time` 轉為 UTC+8（`YYYY-MM-DD HH:mm:ss +08:00`）。

## 更正說明（round-trip 判斷）

- `Qixingshan.gpx` 的起終點距離已相當接近，本身可視為 round-trip／closed-loop 行為。  
- 舊邏輯固定做「去程 + 反向回程」；若 GPX 本來已閉合，會再被鏡像一次，造成路徑重複與距離可能雙算。  
- 目前已改為**自動偵測分支**，不再假設所有路線都必須強制鏡像回程。

## 本次修正（index.html）

- 新增 `analyzeRoundTrip(points)`，以路線總長、起終點距離與閉合門檻判斷 `alreadyRoundTrip`。  
- 在 `loadRouteFromGpx` 中改為分支處理：  
  - `alreadyRoundTrip === true`：直接使用原始 `yushanWaypoints`。  
  - `alreadyRoundTrip === false`：才追加反向點建立來回路線。  
- 保留 `GPX_ROUTE_MODE` 記錄（`console.info`）以便檢查判斷結果。

## 現況結論

- 路徑是否呈現「來回/翻倍」取決於 GPX 本身形態與自動判斷結果，已非固定行為。  
- `Qixingshan.gpx` 在目前邏輯下可避免被再次鏡像，降低重複路徑與距離雙算風險。

## 附錄：關鍵程式位置（index.html）

- UTC+8 時間格式：`index.html:189-206`  
- round-trip 偵測：`index.html:208-237`  
- GPX 載入與自動分支建構路線：`index.html:239-307`  
- 播放防呆（可用性檢查/失敗中止）：`index.html:123-144`、`index.html:390-433`、`index.html:454-504`
