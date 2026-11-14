# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案性質

手機優先的記帳網頁（PWA），UI 與 commit 訊息皆為繁體中文。**純靜態 HTML/CSS/vanilla JS：無框架、無建置步驟、無外部 CDN**，必須能完全離線運作；所有帳目只存在使用者手機瀏覽器本機，不得接任何雲端服務。部署在 GitHub Pages（`main` 分支根目錄，repo：`linliu1127/bookkeeper`）。

## 指令

- 本機預覽：`python3 -m http.server 8000`，開 `http://localhost:8000`（service worker 只在 HTTPS 或 localhost 註冊）。
- 沒有 package.json、linter 或測試框架，repo 內也沒有測試檔。`calc.js` 與 `report-core.js` 是不碰 DOM 的 UMD 純函式模組，可直接 `require()` 用 node 寫臨時測試；語法檢查用 `node --check <file>.js`。
- 部署即 `git push`，Pages 約 1 分鐘後更新。

## 架構

載入順序固定（`index.html`）：`calc.js` → `store.js` → `categories.js` → `backup.js` → `report-core.js` → `app.js` → `report.js` → `catedit.js`。模組靠全域變數互相呼叫（`Calc`、`Store`、`Categories`、`Backup`、`ReportCore`、`Report`、`CatEditor`），沒有 import。

- **`store.js`**：資料唯一來源。`Store.entries` 是**單一陣列物件，全程原地修改**（`length = 0` + `push`），其他模組都持有它的參照，不要重新賦值。主存 IndexedDB，同步寫 localStorage 當保險，啟動時要求 `navigator.storage.persist()`。修改後須呼叫 `Store.save()`。
- **`app.js`**（一個大 IIFE）：流水帳列表、新增／編輯表單與計算機、復原／重做、月份／整年篩選、側邊抽屜、設定頁與還原流程。透過 `window.BK = {CATS, entries, fmt, h, iconOf, toast, openOverlay, closeOverlay, catData, catsChanged, reportCats}` 把共用工具交給 `report.js`／`catedit.js`；類別資料見下方「類別」一條。DOM 一律用 `h()` 建立並用 `textContent`，不要用 innerHTML 拼接資料。
- **全螢幕頁面**（新增表單、設定、報表）都走 `openOverlay()/closeOverlay()`，它會 `history.pushState`，讓 Android 返回鍵先關頁面。側邊抽屜刻意**不**進歷史紀錄（避免與 `history.back()` 競態）。
- **復原／重做**記錄的是操作（add/edit/del），只存在記憶體，關閉 App 即清空；「從備份還原」整批匯入不納入並會清空歷史。
- **`backup.js`**：用 File System Access API（`showSaveFilePicker`）寫入使用者選定的固定 JSON 檔。**實測只有 Chrome Android 有此 API，Brave 沒有**；不支援時設定頁不會出現「設定自動備份檔」，退回手動匯出（檔名帶日期時間，避免 `(1)` 堆積）與「未備份變更」計數提醒。檔案授權的 `requestPermission` 必須在使用者點擊中呼叫，所以綁在「儲存」按鈕的同一次點擊（`onSave` 內須先於任何 `await`）。備份檔格式 `{version:2, exportedAt, entries, categories}`，還原以 `id` 合併帳目、類別以名稱聯集合併（再補上帳目用到但清單沒有的名稱），並逐筆驗證；缺 `categories` 的檔案照常還原。
- **類別（`categories.js` / `catedit.js`）**：類別不再寫死。`categories.js` 是不碰 DOM 的 UMD 模組，集中所有規則（新增／刪除／改名、重複與長度檢查、合併、`normalize` 清理壞資料、`withUsed`）。清單 `catData = {expense:[{name,icon,subs[]}], income:[…]}` 存在 `Store.kvSet('categories')`，內建預設在 `Categories.defaults()`。`app.js` 的 `CATS`（`[名稱, 圖示]` 視圖）由 `syncCats()` **就地重建**，其餘程式照舊讀 `CATS`；報表改用 `BK.reportCats()`（清單 ∪ 帳目實際用到的名稱）。帳目以**名稱字串**記類別，另有選填 `sub`（子類別，沒有就不寫）；因此刪除類別不改帳目，同名重建會自然對回舊帳目，改名則批次替換帳目並須清空復原紀錄（`BK.catsChanged({entriesChanged:true})`）。`catedit.js` 只管編輯器畫面。
- **`report-core.js` / `report.js`**：報表運算與繪圖分離。core 負責彙總、月份範圍、月序列、圓餅圖角度、座標刻度；`report.js` 用手寫 inline SVG 畫圓餅圖與折線圖。`monthlySeries(..., until)` 對「未來且無資料」的月份回傳 `null`（圖上斷線，不補 0）。圖表配色是 `style.css` 內 `--c1..--c8`／`--c-other`（已用 dataviz 技能的 validate_palette 驗證，順序固定）；超過 8 類時圓餅圖合併尾端成灰色，但下方表格仍逐一列出。
- **`sw.js`**：快取優先（離線、弱網秒開）。更新靠遞增 `CACHE`：新版整批抓進新快取後進入等待，`app.js` 偵測到就顯示「有新版可用」，使用者點「立即更新」才 `SKIP_WAITING` 並重載（避免新舊檔混用）。**新增或改名任何要離線使用的檔案、或改了任何已快取的檔案，都必須同步更新 `ASSETS` 並遞增 `CACHE`**，否則使用者永遠停在舊版。本機開發看不到變更時請遞增 CACHE 或在 DevTools 勾 Update on reload。

## 注意事項

- 資料模型：`{id, date:'YYYY-MM-DD', type:'expense'|'income', category, sub?, amount(正數), note, createdAt}`。日期一律用本地時區組字串，不要用 `toISOString()`。
- 計算機（`calc.js`）刻意不使用 `eval`，結果四捨五入到小數 2 位。
- GitHub Pages 站台是公開的：**不得把備份 JSON 或任何使用者資料放進 repo**（`.gitignore` 已擋 `bookkeeper-*.json`）。
- 本機用無頭 Firefox 截圖驗證時：Firefox 是 snap 版，`--profile` 與輸出檔必須放在 home 目錄底下；App 啟動要等 IndexedDB，截圖前需延後 `load` 事件才看得到列表內容。
- 只在使用者要求時才 commit / push。
