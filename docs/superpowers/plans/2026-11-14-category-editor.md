# 類別編輯器（含子類別）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用者可在「類別編輯器」新增／刪除／改名類別與子類別，記帳時可選子類別，類別設定隨備份 JSON 一併儲存與還原。

**Architecture:** 新增不碰 DOM 的 `categories.js`（UMD，node 可測）負責類別資料的所有規則；`app.js` 持有 `catData`（存 `Store.kvSet('categories')`），並把既有的 `CATS` 以「就地重建」方式由它衍生，讓 app.js 其餘程式與 `report.js` 幾乎不用改；新增 `catedit.js` 只負責編輯器 UI。帳目新增選填欄位 `sub`。

**Tech Stack:** 純 HTML/CSS/vanilla JS（無框架、無建置、無 CDN）、IndexedDB、node（僅臨時測試）。

**Spec:** `docs/superpowers/specs/2026-11-14-category-editor-design.md`

## Global Constraints

- UI 文字與 commit 訊息一律繁體中文；DOM 用 `h()` + `textContent`，不用 innerHTML 拼資料。
- 無框架、無建置步驟、無外部 CDN，必須可完全離線運作。
- 新增檔案必須加進 `sw.js` 的 `ASSETS`，並遞增 `CACHE`（目前 `bookkeeper-v6`）。
- `Store.entries` 是單一陣列、原地修改，不得重新賦值；修改後呼叫 `Store.save()`。
- 全螢幕頁面走 `openOverlay()/closeOverlay()`。
- 日期用本地時區組字串。不得把任何使用者資料放進 repo。
- 只在使用者要求時才 commit / push：**本計畫的 commit 步驟只在使用者說 commit 時才執行**，否則略過。
- 測試檔放在 `/home/linliu1127/.claude/jobs/a42a6e40/tmp/`（repo 內不放測試檔）。
- 刪除類別／子類別**不得改動既有帳目**；類別名稱 trim 後 1–12 字、子類別 1–20 字；同層（同 type；子類別則同一類別內）名稱全等即視為重複。
- 備份格式 `{version:2, exportedAt, entries, categories}`；不需相容舊版以外的格式，但缺 `categories` 的檔案仍須能還原。

## Review Focus

1. 已有帳目的類別或子類別被刪除後，開啟該帳目編輯並存檔，不得默默改掉它的類別／子類別。
2. 備份檔的 `categories` 為 `null`、字串、含空白名稱／重複名稱／非陣列 `subs` 時，還原不崩潰，只採用合法部分。
3. 子類別改名只影響「同 type、同類別」底下的帳目；支出與收入各有同名類別（如「股票」）時互不影響。
4. 切換類別或切換支出／收入時，已選的子類別必須清掉，不可帶到別的類別。
5. 刪光某 type 所有類別時，新增表單顯示提示（引導到類別編輯器），不應出現空白無法操作的畫面。
6. 改名會改動帳目，復原／重做堆疊若留著舊快照，復原會把名稱改回舊的 → 改名後須清空歷史。

---

### Task 1: `categories.js` 類別資料規則

**Files:**
- Create: `categories.js`
- Test: `/home/linliu1127/.claude/jobs/a42a6e40/tmp/categories.test.js`

**Interfaces:**
- Produces（全域 `Categories`，UMD，同 `calc.js` 寫法）。`Data = {expense: Cat[], income: Cat[]}`，`Cat = {name:string, icon:string, subs:string[]}`；`type` 為 `'expense'|'income'`。
  - `defaults(): Data` — 每次回傳全新物件。內容為目前 `app.js` 的 `CATS`（含股票、債券、外幣）依序轉成 `{name, icon, subs:[]}`。
  - `normalize(raw: any): Data` — 任何輸入都回傳合法 Data：非物件或某 type 缺／非陣列 → 該 type 用 `defaults()` 的對應部分；項目需有字串 `name`（trim 後長度合規）、其餘欄位缺漏時 `icon` 補 `'🏷️'`、`subs` 補 `[]`；丟棄不合規與重複項目；`subs` 同樣清理。
  - `add(data, type, name, icon): {ok:true}|{ok:false, error:string}` — `icon` 空白時用 `'🏷️'`。
  - `remove(data, type, name): boolean`
  - `rename(data, entries, type, oldName, newName): {ok:true, changed:number}|{ok:false, error:string}` — 成功時就地把 `entries` 中 `type`、`category===oldName` 的帳目改成新名；`changed` 為改動的帳目數。新舊名相同 → `{ok:true, changed:0}`。
  - `addSub(data, type, cat, name)`、`renameSub(data, entries, type, cat, oldSub, newSub)`（只改 `type`、`category===cat`、`sub===oldSub` 的帳目）、`removeSub(data, type, cat, sub): boolean`，回傳型別同上對應函式。
  - `merge(data, incoming: Data): void` — 就地聯集（類別以名稱、子類別以名稱）；保留 `data` 既有 icon。
  - `ensureUsed(data, entries): void` — 帳目用到但清單沒有的類別／子類別就補進去（icon `'🏷️'`）。
  - `withUsed(data, entries): Data` — 回傳補齊後的**複本**，不改動 `data`。
  - 錯誤訊息固定為：`'名稱不可空白'`、`'名稱已存在'`、`'名稱太長（最多 12 字）'`（子類別為 `'名稱太長（最多 20 字）'`）、`'找不到類別'`。

- [ ] **Step 1: 寫失敗測試** `categories.test.js`（`require` 該檔，`assert`）。必含斷言：
  - `defaults().expense` 含 `'股票'`、`'債券'`、`'外幣'`，`defaults().income` 含 `'股票'`；兩次呼叫回傳的不是同一物件。
  - `add` 空白／全空白 → `error:'名稱不可空白'`；重複 → `'名稱已存在'`；13 字 → 太長；`'  旅行  '` 存成 `'旅行'`；支出與收入可各有同名。
  - `rename` 重複名拒絕且 data／entries 皆不變；成功時只改同 type 帳目（建一筆 expense「股票」、一筆 income「股票」，改支出的名稱，收入那筆不變）；回傳 `changed` 正確。
  - `renameSub`：兩個不同類別都有子類別「A」，只改其中一個類別時，另一個類別的帳目 `sub` 不變。
  - `remove` 不改 entries（傳入 entries 陣列前後 deepEqual）；刪後再 `add` 同名成功。
  - `normalize(null)`、`normalize('x')`、`normalize({expense:'bad'})`、含空白名稱／重複名稱／`subs:'bad'` 的輸入，皆回傳可通過同一組檢查的合法 Data（不丟例外、無重複、無空名）。
  - `merge` 聯集且保留既有 icon；`ensureUsed` 補上帳目的 `{category:'X', sub:'Y'}`；`withUsed` 不改原物件。
- [ ] **Step 2: 執行確認失敗** — `node <tmp>/categories.test.js`，預期 `Cannot find module` 或斷言失敗。
- [ ] **Step 3: 實作 `categories.js`**，簽名如上；無 DOM、無全域副作用。
- [ ] **Step 4: 執行確認通過** — 同指令，預期輸出 `all categories tests passed`（測試檔最後印出）。
- [ ] **Step 5: Commit**（僅在使用者要求時）— `git add categories.js && git commit -m "新增類別資料規則模組 categories.js"`

---

### Task 2: 類別資料接進 app、備份與還原

**Files:**
- Modify: `app.js`（`CATS` 區塊約 4–19、`start()`、`doRestore`、`window.BK`）、`backup.js`（`init`、`payload`、`parse`）、`report.js:191`（`seriesDefs`）、`index.html`（script 順序）、`sw.js`

**Interfaces:**
- Consumes: Task 1 的 `Categories.*`。
- Produces:
  - `app.js` 內：`var catData: Data`；`syncCats(): void` — 就地重建 `CATS`（`CATS.expense`/`CATS.income` 仍為 `[name, icon][]`），使既有程式不用改；`async saveCats(): Promise<void>` — `Store.kvSet('categories', catData)`，`Backup.bump()`，`Backup.schedule()`，`syncCats()`。
  - `window.BK` 新增：`catData(): Data`（回傳 live 物件）、`catsChanged(opts?: {entriesChanged?: boolean}): Promise<void>`（呼叫 `saveCats()`，`entriesChanged` 時另外清空 `undoStack`/`redoStack`、`paintHistory()`、`Store.save()`，最後 `render()`）、`reportCats(): {expense:[name,icon][], income:[name,icon][]}`（`Categories.withUsed(catData, entries)` 轉成同形狀）。
  - `Backup.init(dataFn, onChange, catsFn)`：`catsFn(): Data`。`Backup.parse(text): {entries, categories: Data}`（**回傳型別改變**，唯一呼叫者 `doRestore`；`categories` 用 `Categories.normalize`，缺欄位時 normalize 結果為預設）。`parse` 的帳目映射新增可選 `sub`（字串，trim，最多 20 字，空則省略）。

- [ ] **Step 1: 寫失敗測試**（node `vm.runInNewContext` 載入 `categories.js` 與 `backup.js`，stub `window={}`、`localStorage`、`Store`）：`Backup.parse(JSON.stringify({version:2,entries:[{id:'a',date:'2026-01-02',type:'expense',category:'旅遊',sub:' 機票 ',amount:5,note:''}],categories:{expense:[{name:'旅遊',icon:'✈️',subs:['機票']}]}}))` 回 `entries[0].sub==='機票'` 且 `categories.expense[0].subs` 含 `'機票'`；`categories:null` 與缺 `categories` 皆回預設（含 `'外幣'`）；舊式純陣列輸入仍可解析。測試檔 `<tmp>/backup-parse.test.js`。
- [ ] **Step 2: 執行確認失敗**。
- [ ] **Step 3: 實作** `backup.js` 改動（`payload()` 輸出 `version:2` 並含 `categories: catsFn()`；`parse` 如上）。
- [ ] **Step 4: 實作 `app.js` 整合**：
  - `CATS` 的內建值移到 `Categories.defaults()`；`CATS` 改為空殼物件 `{expense:[], income:[]}`，由 `syncCats()` 填入。
  - `start()` 在 `Store.init()` 之後：`catData = Categories.normalize(await Store.kvGet('categories'))`；既有 `migrateCats(entries)`（投資→股票）保留，並順手對 `catData` 做同樣改名（`投資`→`股票`，若 `股票` 已存在則不重複）；`syncCats()`；傳 `function(){return catData;}` 給 `Backup.init`。載入時**不** `bump`（只有改名遷移才 bump，既有行為）。
  - `doRestore`：`var parsed = Backup.parse(text)`；`Categories.merge(catData, parsed.categories)`；合併帳目後 `Categories.ensureUsed(catData, entries)`；`await saveCats()` 後再 `Store.save()`。
  - `window.BK` 加上三個新成員。`report.js` `seriesDefs` 的 `BK().CATS` 改為 `BK().reportCats()`。
  - `index.html` 在 `backup.js` 前加 `<script src="categories.js">`（`calc.js`、`store.js` 之後即可，須早於 `backup.js`）；`sw.js` `ASSETS` 加 `'categories.js'`，`CACHE` → `bookkeeper-v7`。
- [ ] **Step 5: 驗證** — 兩個 node 測試通過；`node --check app.js backup.js report.js sw.js`；本機起 `python3 -m http.server`，無頭 Firefox 開頁確認列表與新增表單的類別與整合前一致（截圖存 home 底下，截圖後刪除暫存）。
- [ ] **Step 6: Commit**（僅在使用者要求時）— 訊息：「類別改存本機資料庫並納入備份（備份格式 v2）」。

---

### Task 3: 帳目子類別（表單、列表、復原）

**Files:**
- Modify: `app.js`（`openForm`、`paintForm`、`#f-type` handler、`onSave`、列表 `.mid`、復原／重做相關快照）、`index.html`（`#sheet` 內加子類別容器）、`style.css`

**Interfaces:**
- Consumes: Task 2 的 `catData`、`CATS`。
- Produces: 帳目選填欄位 `sub: string`（無子類別時**不寫此欄位**）；`form` 物件加 `sub: string`。

- [ ] **Step 1: 實作表單**：`form` 初始化含 `sub`（編輯時取 `entry.sub || ''`）。`paintForm` 在類別 chip 下方新增 `#f-subs` 一排 chip：只在目前類別在 `catData` 有子類別（或編輯中的帳目自帶 `sub`）時顯示；點選設定、再點同一個取消。類別 chip 點選時若類別改變則 `form.sub = ''`；`#f-type` 切換 type 時 `form.sub = ''`。編輯帳目時若其 `category` 或 `sub` 已不在清單，仍以額外 chip 顯示並可選（Review Focus 1）。某 type 無任何類別時 `#f-cats` 顯示一行提示「尚無類別，請到選單的類別編輯器新增」（Review Focus 5）。
- [ ] **Step 2: 實作儲存與顯示**：`onSave` 新增與編輯都寫 `sub`（空則 `delete e.sub`／不寫）。列表 `.mid .cat` 文字改為 `e.sub ? e.category + ' › ' + e.sub : e.category`；undo/redo 的操作快照與提示文字（約 app.js:76）要帶 `sub`，使復原編輯能還原子類別。
- [ ] **Step 3: 樣式**：`#f-subs` 用較小的 chip（沿用 `.cat-btn` 風格但不含 emoji），窄螢幕可換行或橫向捲動，不得造成頁面橫向捲動。
- [ ] **Step 4: 驗證** — `node --check app.js`；無頭 Firefox 以預先寫入 `Store` 的測試資料（可在頁面 console 呼叫 `BK.catData()` 加子類別再 `BK.catsChanged()`）截圖確認子類別 chip 與列表「旅遊 › 機票」；Review Focus 1、4、5 逐項手動操作並記錄結果，無法實測者明確告知使用者。
- [ ] **Step 5: Commit**（僅在使用者要求時）— 訊息：「帳目可選子類別，列表顯示「類別 › 子類別」」。

---

### Task 4: 類別編輯器 UI 與選單入口

**Files:**
- Create: `catedit.js`
- Modify: `index.html`（drawer 項目、`#catedit` 區塊、script）、`app.js`（drawer click handler）、`style.css`、`sw.js`、`CLAUDE.md`

**Interfaces:**
- Consumes: `BK.catData()`、`BK.catsChanged({entriesChanged})`、`BK.entries`、`BK.h`、`BK.toast`、`BK.openOverlay/closeOverlay`、`Categories.*`。
- Produces: `CatEditor.open(): void`、`CatEditor.init(): void`（綁 `#ce-close`、分頁）。

- [ ] **Step 1: 版面**：`index.html` 新增 `#catedit`（仿 `#report`：`.sheet`、`.sheet-top` 標題「類別編輯器」與關閉鈕、`.seg` 分頁「支出｜收入」、`.sheet-body#ce-body`）。drawer 在「財務報表」後加 `<button data-go="catedit">🏷️　類別編輯器</button>`；`app.js` drawer handler 加 `else if (b.dataset.go === 'catedit') CatEditor.open();`。`catedit.js` 載入順序在 `report.js` 之後；`sw.js` `ASSETS` 加 `'catedit.js'`，`CACHE` → `bookkeeper-v8`。
- [ ] **Step 2: 實作 `catedit.js`**（資料操作一律走 `Categories.*`，成功後 `await BK.catsChanged(...)` 再重繪；失敗用 `BK.toast(result.error)`）：
  - 每個類別一列：icon、名稱、子類別數、「改名」「刪除」按鈕；點列展開子類別清單，每個子類別有「改名」「刪除」，底部有「新增子類別」輸入。
  - 底部「新增類別」：名稱輸入 + emoji 輸入（可空，預設 🏷️）。
  - 改名用 `prompt()` 取得新名稱（預設為舊名）；類別或子類別改名成功且 `changed > 0` 時 `catsChanged({entriesChanged:true})`，否則 `catsChanged()`（Review Focus 6）。
  - 刪除用 `confirm('刪除「X」？既有帳目不受影響。')`，通過才執行。
  - 展開狀態只存在記憶體，重繪後維持。
- [ ] **Step 3: 樣式**：列高 ≥ 44px 方便觸控；按鈕用既有 `.btn`／`.icon-btn` 風格；深色模式用既有 token。
- [ ] **Step 4: 文件**：`CLAUDE.md` 架構段新增 `categories.js`／`catedit.js` 說明、載入順序（`calc.js → store.js → categories.js → backup.js → report-core.js → app.js → report.js → catedit.js`）、`entry.sub`、刪除語意、備份格式 v2。
- [ ] **Step 5: 驗證** — `node --check catedit.js app.js sw.js`；無頭 Firefox 截圖編輯器（支出分頁、展開一個類別、收入分頁）；手動操作：新增類別→在新增表單看得到→刪除→舊帳目仍顯示原名稱；改名後列表與報表（開報表看圓餅圖）一致且復原按鈕無法把名稱改回舊的；Review Focus 2、3 以 node 測試已覆蓋，此處抽查一次備份匯出的 JSON 含 `categories`。UI 無法實測的部分（觸控、深色）明確告知使用者請在手機驗證。
- [ ] **Step 6: Commit**（僅在使用者要求時）— 訊息：「新增類別編輯器：類別與子類別可增刪改名」。
