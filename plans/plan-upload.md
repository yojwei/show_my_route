# GPX Upload + Auto-Play Plan

## Problem
目前路線只會從固定路徑載入 GPX（`gpx/Qixingshan.gpx`）。使用者無法自行上傳 GPX 檔；也沒有「上傳成功後直接播放」的流程。

## Proposed approach
1. 在 UI 加入 GPX 上傳入口（按鈕 + hidden file input + 狀態訊息）。
2. 將 GPX 解析邏輯拆為可重用流程，支援「URL 載入」與「File 上傳載入」。
3. 上傳成功後重建 route 資料與地圖 source/layer，重置動畫狀態，並在條件滿足時自動開始播放。
4. 保留既有防呆：route/map/source readiness、距離有限值檢查、錯誤時停止動畫。
5. 維持既有功能：
   - GPX trk/name -> H1
   - metadata/time -> description（UTC+8）
   - round-trip 自動判斷（避免重複鏡像）

## Execution todos
- 實作 upload UI 元件與事件綁定
- 擴充載入函式以支援 File 來源
- 新增地圖 route 重新載入流程（避免重建整張 map）
- 加入「載入完成即自動播放」流程與錯誤處理
- 完成語法與行為驗證

## Notes
- 上傳新檔案時若正在播放，先安全停止播放再切換路線。
- 若檔案無效或解析失敗，維持現況並顯示錯誤訊息。
