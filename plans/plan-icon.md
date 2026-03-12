# Start/End A/B Red-Flag Marker Plan

## Problem statement
目前地圖路線缺少明確的起點與終點視覺標記。使用者只能靠路線形狀或播放起始位置判斷方向，不利於快速辨識「從哪裡開始、到哪裡結束」。

## Proposed implementation approach
1. 以路線座標陣列第一點作為起點（A）、最後一點作為終點（B）。
2. 新增一個起終點 GeoJSON source，包含兩個 Point feature：
   - `type: start`, `label: A`
   - `type: end`, `label: B`
3. 以紅色旗標小圖示呈現（可用 SVG data URI + `map.addImage`），並以 `symbol` layer 疊加：
   - 起點使用帶 A 的紅旗 icon
   - 終點使用帶 B 的紅旗 icon
4. 在路線重載（例如 GPX 上傳成功）時同步更新 source，確保 A/B 永遠對應最新路線。
5. 若 icon 載入失敗，使用 `circle + text` 作為 fallback（紅色圓點 + A/B）避免功能中斷。

## Execution todos
- 建立 A/B flag icon 載入流程（含 fallback）。
- 建立/更新起終點 GeoJSON source 與 symbol layer。
- 將 marker 更新流程串接到初始載入與路線重載路徑。
- 補齊錯誤處理與防重複加層（layer/source 已存在時先更新）。
- 完成手動驗證並記錄結果。

## Validation notes
- 起點顯示紅旗 A，位置等於路線第一個座標。
- 終點顯示紅旗 B，位置等於路線最後一個座標。
- 預設 GPX 與上傳 GPX 皆能正確顯示/更新 A/B。
- 地圖縮放與播放過程中 icon 不消失、不錯位。
- Console 無 layer/source/image 重複註冊錯誤。
