# 近期修正與研究紀錄（GPX 路線顯示）

## 修正清單（已落地）

- **GPX 載入與路線資料來源改造**  
  路線來源已由硬編碼改為 `loadRouteFromGpx('gpx/Qixingshan.gpx')`，透過 `fetch + DOMParser` 解析 `trkpt`，並重建 `yushanWaypoints`、`fullRouteCoords`、`routeLine`、`totalDistance`、`routeDistanceProfile`。

- **coord 錯誤防呆（播放前檢查、動畫檢查、失敗停用控制）**  
  已加入播放前可用性檢查（`routeReady/mapReady/pointSourceReady/totalDistance`）、動畫幀前置驗證（`hasRouteLine` 與距離有限值檢查），以及異常時 `stopAnimationWithError` 中止播放並停用控制，避免 `coord is required` 類型錯誤擴散。

- **H1 使用 GPX trk/name**  
  介面標題（`#route-title`）已改為優先顯示 GPX 的 `trk/name`。

- **Description 使用 GPX metadata/time**  
  描述欄（`#route-description`）已改為優先顯示 GPX 的 `metadata/time`（經格式化後）。

- **metadata/time 轉換為 UTC+8（`YYYY-MM-DD HH:mm:ss +08:00`）**  
  已新增時間格式化流程，將 GPX 時間轉為 `+08:00` 並輸出固定格式字串。

## 研究結論（未必是 bug）

- **為何路徑看起來跑兩次（來回路徑設計）**  
  目前路徑建構採「去程 + 反向回程」：先放完整 `yushanWaypoints`，再把尾端往回推回 `fullRouteCoords`，因此視覺上會像同一路線跑兩次。

- **為何總距離看起來翻倍（計算的是來回距離）**  
  `totalDistance` 是基於來回後的 `routeLine` 計算，結果自然接近單程距離的兩倍，屬於目前設計結果，非計算器壞掉。

## 現況與建議

- 若要**單程距離**：路徑建構改為僅使用原始 `yushanWaypoints`（不追加反向回程點），`totalDistance` 即回到單程口徑。  
- 若要**單程播放**：動畫終點停在單程終點，不走折返段；UI 文案建議由「↔」調整為「→」，避免使用者誤判。  
- 若要同時支援兩種模式：可規劃「單程 / 來回」切換設定，並同步切換路徑建構與距離/文案顯示規則。

## 附錄：關鍵程式位置（index.html 行號區段）

- GPX 載入、解析與路線資料重建：`index.html:208-260`  
- 來回路徑建構（路徑看似跑兩次、距離計為來回）：`index.html:253-256`  
- H1 / Description 套用 GPX 欄位：`index.html:262-267`  
- metadata/time 轉 UTC+8 格式：`index.html:189-206`  
- 播放前防呆與控制可用性：`index.html:123-136`、`index.html:467-480`、`index.html:492-504`  
- 動畫幀檢查與失敗中止：`index.html:138-144`、`index.html:390-416`、`index.html:420-433`
