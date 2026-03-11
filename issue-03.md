# Issue 03 研究議題：確認地形完全載入再開始播放

## 1) 問題描述
目前播放開始條件與地形載入時機不一致。現有流程只要播放 gate 通過就可開始，但 `map load` 完成不代表 terrain tiles（DEM）已完整就緒。

## 2) 現況證據
- 目前播放 gate 為 `routeReady / mapReady / pointSourceReady`。  
- `mapReady` 於 `map.on('load', ...)` 內設為 `true`，這僅代表 style/基礎資源可用，不等於地形來源完整載入。  
- 程式中已定義 terrain source（`terrain-source`）與 `terrain` 設定，但缺少 terrain-ready 的顯式判斷。  
- `index.html` 內未見 `terrainReady`、`sourcedata`、`isSourceLoaded('terrain-source')`、`idle` 相關 gate 判斷。

## 3) 影響
播放可能在地形尚未完整載入時開始，導致初段畫面出現視覺跳動、鏡頭/地形細節突變，造成體驗不一致。

## 4) 建議方案（研究建議，不改碼）
- 新增 `terrainReady` gate（初始為 `false`）。  
- 以 `sourcedata` 事件監測 terrain 載入，並結合 `isSourceLoaded('terrain-source')` 判斷來源是否完成。  
- 再加上 `idle`（地圖進入空閒）作為最終穩定條件，降低「剛可用但仍在補載」風險。  
- 播放按鈕可用條件需納入 `terrainReady`（`routeReady && mapReady && pointSourceReady && terrainReady`）。  
- 增加 timeout/fallback：若等待超時，提供明確提示與降級策略（例如允許使用者手動繼續或延後重試）。

## 5) 驗收準則（如何判定已解決）
- 在慢網路或首次載入情境下，`terrainReady` 仍為 `false` 時播放按鈕不可觸發播放。  
- 只有在 `terrainReady = true` 後才可開始播放，且 log 可追蹤 gate 狀態轉換。  
- 播放起始前 3–5 秒不再出現明顯地形補載造成的視覺跳動。  
- 觸發 timeout 時，系統能依 fallback 策略給出可預期行為（提示/重試/手動繼續）。

## 6) 附錄：關鍵程式區段行號（`index.html`）
- 播放 gate 狀態與可用性判斷：`116-143`（`routeReady/mapReady/pointSourceReady`、`updatePlayAvailability`）  
- 播放觸發前 guard：`479-491`（`startPlayback` 內使用既有 gate）  
- terrain source 與 terrain 設定：`524-541`（`terrain-source`、`terrain`）  
- `mapReady` 設定時機：`550-553`（`map.on('load', ...)` 內設為 `true`）
