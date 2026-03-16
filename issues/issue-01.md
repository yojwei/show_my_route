# Issue 01 研究報告：`Uncaught Error: coord is required.`

## 1) 問題描述（症狀、錯誤訊息）
- 症狀：按下播放後，動畫中斷，Console 出現未捕捉錯誤。
- 錯誤訊息：`Uncaught Error: coord is required.`
- 依現有程式流程，錯誤最可能出現在動畫幀內 Turf 計算階段（`index.html` 300-303）。

## 2) 可能拋錯點（依機率排序，附 line 參考）
1. **`animateMarker` 內的 Turf 呼叫**（`index.html:300-303`）  
   - `turf.along(routeLine, currentDistance, ...)`  
   - `turf.along(routeLine, lookAheadDistance, ...)`  
   - `turf.bearing(currentPoint, lookAheadPoint)`  
   這段每幀都執行，且直接依賴 `routeLine/currentDistance/lookAheadDistance` 的有效性。

2. **起始點建立**（`index.html:265`）  
   - `turf.point(fullRouteCoords[0])`  
   若 `fullRouteCoords[0]` 無效，後續 Turf/地圖資料都可能進入不合法狀態。

3. **路線建立與距離剖面計算鏈**（`index.html:117-119, 197-198`）  
   - `turf.distance(...)`（剖面）  
   - `turf.lineString(fullRouteCoords)`、`turf.length(routeLine, ...)`  
   若座標或距離出現非預期值，會把無效狀態往後傳到動畫流程。

> Turf 佐證：  
> - `@turf/invariant` 的 `getCoord` 明確在 `!coord` 時 `throw new Error("coord is required")`。  
> - `@turf/along` 會在迴圈中執行 `distance(coords[i], coords[i + 1], options)`；當距離/座標狀態異常時，`coords[i + 1]` 可變成 `undefined`，最終由 `getCoord` 拋出上述錯誤。

## 3) 最可能根因
**動畫在路線資料或地圖狀態未就緒時被啟動。**  
依 `bootstrap` 與播放流程（`index.html:334-352`）可見：
- 路線載入是 async（334-337）。
- 播放按鈕事件已先綁定，且按下時未檢查「路線/地圖 source 是否 ready」（344-352）。
- 即使初始化失敗（338-341），程式也未看到停用播放控制的處理。  

因此可能在未就緒或部分失敗狀態下進入 `animateMarker`，造成 Turf 收到無效輸入並觸發 `coord is required`。

## 4) 可重現條件（至少 2 條）
1. **頁面剛開啟即快速按播放**（慢網路/首次載入時更容易），在 `loadRouteFromGpx` 或地圖 source 尚未完成時進入動畫。  
2. **GPX 載入失敗後仍按播放**（例如路徑錯誤、檔案不可讀、網路失敗），初始化 catch 後仍可能觸發動畫流程。  
3. **路線距離/座標進入非數值狀態（如 `NaN`）** 時，`along` 內部可能走到 `distance(..., undefined)`，再由 `getCoord` 拋錯。

## 5) 建議修復（不直接改程式碼，但可執行）
1. **加入就緒閘門**：定義 `routeReady`、`mapReady`，兩者都 true 才允許播放。  
2. **播放前輸入驗證**：檢查 `routeLine` 存在、`fullRouteCoords.length >= 2`、`Number.isFinite(totalDistance)`。  
3. **初始化失敗即鎖定播放**：bootstrap catch 後停用播放鍵並顯示原因。  
4. **動畫幀防呆**：在呼叫 `along/bearing` 前驗證 `currentDistance/lookAheadDistance` 為有限數，否則中止動畫並回報。  
5. **分離「資料就緒」與「UI 可互動」時機**：僅在 `loadRouteFromGpx` 完成且 map `load` 後開放播放。

## 6) 建議加的診斷 log
- **bootstrap 成功/失敗**
  - `points.length`, `fullRouteCoords.length`, `totalDistance`
  - `routeLine?.geometry?.coordinates?.length`
- **play click 當下**
  - `routeReady`, `mapReady`, `hasPointSource`, `totalDistance`, `currentDistance`
- **animateMarker（節流輸出）**
  - `currentDistance`, `lookAheadDistance`, `Number.isFinite(...)`
  - `routeLine coords length`
- **Turf 前置檢查失敗時**
  - 明確輸出哪個參數是 `undefined/null/NaN`，並 `console.error('[ANIM_GUARD_FAIL]', { ... })`
