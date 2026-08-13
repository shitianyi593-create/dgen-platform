# BytePlus AI Gen Platform

BytePlus 生成式 AI 的一站式除錯 / 展示平台，包含五個分頁：

- **影片生成**（`/video`，Seedance 2.0）— 首幀 / 首尾幀 / 多模態三種生成模式、圖片 / 影片 / 音訊參考輸入、`asset://` 私有素材引用、`[Image N]` 提示詞編號、瀏覽器端 zip 匯出 / 匯入、**可重整恢復的併發任務追蹤**（sessionStorage 持久化 + 背景輪詢 + 可設定的任務 TTL）
- **影片生成 2.5**（`/video-25`，Seedance 2.5）— 2.5 規格獨立頁：多模態 0–30 圖 / 0–10 影 / 0–10 音、480p / 720p、長度 4–30 秒或 Auto、`@Image1` 提示詞標籤、**提示詞優化開關**（LLM 依官方指南改寫 + 預覽確認 + 任務類型參數自動修正）；歷史 / 輪詢 / 匯出與 2.0 頁共用
- **圖片生成**（`/image`，Seedream 4.0–5.0）— 文生圖 / 圖生圖 / 組圖（sequential）、四種模型能力檔位、輸出 URL 一鍵複製串接圖生影片
- **文字生成**（`/chat`，Seed LLM）— 除錯導向的 Chat UI，**Chat Completions 與 Responses API 雙模式**、串流 / 非串流、每輪 token / 延遲 / 快取命中統計、raw request/response 檢視
- **私有素材庫管理**（`/assets`）— ARK Asset 庫的建立 / 上傳 / 批次刪除 / 狀態輪詢

所有憑證採 **BYO 模式**從 UI 輸入、sessionStorage per-tab 保存；影片 / 音訊參考素材走 TOS pre-signed URL 安全上傳。

---

## 前置需求

### 執行環境

- **Node.js** 20.19+ 或 22.12+（Vite 8 / vitest 4 的官方需求；測試在 Node 20–25 通過）
- **npm** 9 以上

### BytePlus 帳號需要準備好的東西

| 項目 | 用途 | 取得方式 |
|---|---|---|
| ModelArk **API Key** | 三個生成分頁共用的推論驗證 | BytePlus ModelArk console |
| **Endpoint ID**（影片 / 圖片 / 文字，至少一個） | 各分頁對應的推論部署：Seedance（影片）、Seedream（圖片）、Seed（文字） | 自行依 [BytePlus 官方文件](https://docs.byteplus.com/) 在 ModelArk 部署 endpoint，部署後拿到 `ep-...` ID |
| TOS **Bucket** | 影片 / 音訊參考素材的安全託管 | BytePlus TOS console 自行建立 |
| **兩組 AccessKey / SecretKey**（見下） | 一組給 TOS、一組給 ARK Asset 庫 | BytePlus IAM |

只想用其中一個分頁的話，填對應的 endpoint 即可（例如只填「文字生成接入點」就能用 `/chat`）；TOS / Asset 憑證只有影片頁與素材庫頁需要。

### 憑證輸入方式（BYO 模式）

**所有憑證都從 UI 輸入，`.env` 不需要填 AKSK。** Header 右上角會看到三顆膠囊（推論 / 素材庫 / TOS）；新使用者打開時三顆都是灰色。

兩個入口都會打開右側憑證 Drawer：

- **點任一膠囊**：drawer 開啟並自動展開、聚焦對應憑證的第一個欄位
- **點齒輪 / 按 `⌘,`（Mac）或 `Ctrl+,`（Windows/Linux）**：drawer 開啟，三個區塊都收合，自己選要編輯哪個

Drawer 內三個區塊：

- **推論憑證** — ModelArk API Key（生成分頁**共用**）+ 接入點欄位：**影片生成接入點**（Seedance 2.0）、**影片生成接入點 (Seedance 2.5)**（選填 — 留空則 `/video-25` 直接以 Model ID `dreamina-seedance-2-5-260628` 呼叫）、**圖片生成接入點**（Seedream）、**文字生成接入點**（Seed）。接入點**至少填一個**。**輸入即時驗證**（regex 比對 BytePlus 真實格式 `ark-{UUID}-{5字元}` / 純 UUID 對 API key；`ep-YYYYMMDDHHMMSS-xxxxx` 對 endpoint），不打網路驗證；沒有「測試連線」按鈕。
- **私有素材庫憑證** — ARK AccessKey / SecretKey + Project Name（預設 `default`）。按「測試連線」打 `/local-api/asset/verify`。
- **物件儲存憑證** — TOS AccessKey / SecretKey + Region（下拉選單：`ap-southeast-1` / `ap-southeast-3` / `cn-beijing` / `cn-shanghai` / `cn-guangzhou` / `cn-hongkong`）+ Bucket（接受純 bucket 名稱或 `bucket/prefix` 格式 — 省略 prefix 會用預設 `seedance-2-0/`）。**Endpoint 自動由 Region 推導**（`tos-{region}.bytepluses.com`），UI 不再顯示。測試連線會打 `/local-api/tos/verify`，順便 bootstrap bucket CORS。

每個區塊改任何欄位 → 對應 Header 膠囊立刻變灰（pend），需重新測試才會變綠。

所有 secret 欄位（5 個 AKSK）右側有眼睛 icon — 預設 `type=password`，點一下切到明文檢查。drawer 關閉時自動回到隱藏。

**拖入 `.env` 一鍵匯入**：drawer 開啟時，把一份 `.env` 檔直接拖進頁面即可批次匯入憑證。支援常見別名（`ARK_API_KEY` / `API_KEY`、`SEEDANCE_*` / `SEEDREAM_*` / `SEED_*` 系列 endpoint 變數、`BYTEPLUS_AK/SK`、`TOS_*` 等，`VITE_` 前綴自動剝除）。檔案只在瀏覽器內解析，不上傳、不落地。

填入後存在瀏覽器 **sessionStorage（per-tab）**，**不寫進 `.env.local`**。同一個 tab 內 refresh 會保留欄位與驗證狀態；關掉 tab 或開新 tab 就清空 — 公用機器上的下一個使用者不會看到上一個人的金鑰。

`.env` 中的 AKSK 欄位（`TOS_ACCESS_KEY`、`TOS_SECRET_KEY`、`BYTEPLUS_AK`、`BYTEPLUS_SK`）僅供 `npm run tos:bootstrap` 與 `verify:*` 這些 operator-only 的 CLI script 使用，**執行中的 server 不再讀取這些變數**。

### 兩組 AKSK 的差別（很重要）

本專案需要**兩組分離的 AccessKey / SecretKey**，分別承擔不同職責，請不要共用同一組：

| AKSK | 在哪裡輸入 | 需要的權限 | 用途 |
|---|---|---|---|
| **TOS 那組** | Drawer →「物件儲存憑證」（或點 Header `TOS` 膠囊） | TOS Full Access | 簽 PUT / GET pre-signed URL；驗證時自動 bootstrap bucket CORS |
| **ARK 那組** | Drawer →「私有素材庫憑證」（或點 Header `素材庫` 膠囊） | ARK Full Access | 呼叫 ARK Asset Open API（建立 / 列出 / 刪除私有素材）|

關鍵是 **TOS 與 ARK 各用一把獨立的 AKSK**、權限只給對應 service（不要直接給 Admin / 全權限 key）。它們可以是同一個 BytePlus 帳號下的兩把 key，只要權限分開即可。

### ⚠️ ep / API key / Asset 必須在同一個 BytePlus 帳號與 project 下

要在影片生成時透過 `asset://asset-xxx` 引用私有素材庫的 asset，**三項憑證必須處在同一個 BytePlus 帳號 + 同一個 project**：

- **推論端**：Seedance Endpoint ID（`ep-...`）+ ModelArk API Key — 隸屬於某個 BytePlus 帳號 / project
- **素材端**：ARK AKSK + Project Name — 也隸屬於某個 BytePlus 帳號 / project

如果推論用 A 帳號 / project-X 的 ep + API key，但 asset 是在 B 帳號 / project-Y 建立的，Seedance 推論時會找不到 asset，會失敗。**三邊都對齊到同一個 BytePlus 帳號 + 同一個 project（多數人就是 `default`）**才能 cross-reference。

TOS 不受此限制 — bucket 可以在**不同 BytePlus 帳號或不同 project**（pre-signed URL 是純 HTTPS GET，不依賴帳號 / project 對齊）。

---

## 一次性設定

### 1. 安裝相依

```bash
cd byteplus-ai-gen-platform
npm install
```

### 2. 在 BytePlus console 建立 TOS Bucket（影片頁 / 素材庫需要）

到 BytePlus TOS console 建立一個 bucket：

- Region 自選（例如 `ap-southeast-1`），之後在 Drawer →「物件儲存憑證」下拉選單選 region；Endpoint 由 Region 自動推導（`tos-<region>.bytepluses.com`），不用手動填
- 不需要先設 CORS — 在 Drawer 填入 TOS 憑證並按「測試連線」時會自動套上

預設所有素材會丟在 `seedance-2-0/` 前綴下，避免污染既有資料。要分流可在 Bucket 欄位輸入 `mybucket/myproject/`，前綴就會用 `myproject/`。

### 3. 設定環境變數（選用）

`.env.local` 對於一般使用是**非必要的**——所有 AKSK 憑證都從 Header 膠囊 / Drawer 填入，TOS bucket 的 CORS 也會在 UI 驗證憑證時自動套上。

只有在需要覆寫 server runtime 選項（`PORT`、`PLATFORM_ORIGIN` 等），或要跑 `verify:*` / `tos:bootstrap` CLI script 時才需要建立 `.env.local`：

```bash
cp .env.example .env.local
```

`.env.local` 已被 `.gitignore` 排除，不會進 git。

### 4. 啟動 dev server

```bash
npm run dev
```

`npm run dev` 會用 `concurrently` 同時跑兩個 process：

- Express API server on http://127.0.0.1:3000（簽章、下載代理、ARK proxy、SPA 靜態服務）
- Vite frontend on http://localhost:5173（透過 proxy 把 `/local-api`、`/api` 轉到 3000）

開啟 **http://localhost:5173**，會自動導向影片生成頁。

如果只想跑前端（後端已經單獨啟動），用 `npm run dev:vite-only`。

### 5.（建議）Smoke test：確認設定都吃進去了

```bash
npm test                 # 全套單元測試
```

---

## 第一次使用流程

1. 點 Header 右上角任一灰色膠囊（或按 `⌘,` / `Ctrl+,` 開齒輪 drawer）設定憑證：
   - **推論憑證**：填入 ModelArk API Key（純 UUID 或 `ark-{UUID}-{5字元}` 格式），加上要用的分頁對應的接入點（影片 / 圖片 / 文字，格式如 `ep-20260327154051-xxxxx`，至少一個）。輸入即時驗證，格式正確 pill 立刻變綠。
   - **私有素材庫憑證**（影片頁 asset 引用 / 素材庫頁需要）：填入 ARK AccessKey / SecretKey；Project Name 預設已是 `default`，按「測試連線」確認後端能用該 AKSK 通過 ARK
   - **物件儲存憑證**（影片 / 音訊參考上傳需要）：下拉選 Region、填 TOS AccessKey / SecretKey、Bucket（純名稱或 `mybucket/prefix`），按「測試連線」確認連線（驗證時會自動設定 bucket CORS）
2. 到「影片生成」分頁，先選**生成模式**（首幀 / 首尾幀 / 多模態，預設多模態），再於「提示詞」欄位描述影片內容；可在文字中以 `[Image 1]` / `[Video 1]` / `[Audio 1]` 引用素材（編號規則見下方「[提示詞素材編號](#提示詞素材編號)」說明，**非必填**）。
3. （可選）上傳參考圖片 / 影片 / 音訊（影片與音訊會自動上傳到 TOS 並轉成短效 pre-signed URL；影片 / 音訊僅多模態模式可用）。
4. （可選）在「Asset 參考」加入 `asset-xxxxx` ID、`asset://` URI 或 `https://...` URL（會被解析成正確的引用形式）。
5. （可選）調整 **Seed**（預設 `-1` = 每次隨機；指定整數可在相同提示詞下取得相似輸出；🎲 按鈕產生隨機固定值方便重現）。
6. 調整畫面比例（預設 `Adaptive`，模型自選）、影片長度（4–15 秒，或 `Auto`）。
7. 點擊「生成影片」按鈕（固定在左欄底部）；任務送出後自動輪詢，影片完成後出現在中間預覽區。
8. 完成後可在右側「任務紀錄」下載 mp4 / 複製 URL（常駐按鈕），或從卡片 ⋯ 選單匯出 zip bundle；之後把 zip 拖回「匯入」即可載入歷史任務並回放。

圖片與文字生成分頁不需要 TOS / Asset 憑證，填好對應接入點即可直接使用（用法見下方「主要功能」）。

---

## 主要功能

### 影片生成頁（`/video`，Seedance 2.0）

#### 生成模式與圖片角色

頁面頂部 segmented control 切換三種模式，各模式允許的參考素材不同：

| 模式 | 參考圖片 | 參考影片 / 音訊 | Asset 參考 |
|---|---|---|---|
| **首幀**（first_frame） | 恰好 1 張，角色固定為首幀 | ❌ | 僅 image 類型 |
| **首尾幀**（first_last_frame） | 恰好 2 張 — 一張首幀 + 一張尾幀（可跨上傳圖與 image asset 組合） | ❌ | 僅 image 類型 |
| **多模態**（multimodal，預設） | 0–9 張（角色為參考圖） | 影片 0–3 段、音訊 0–3 段，各總長 ≤ 15 秒 | image / video / audio 皆可 |

- 每張圖縮圖有角色徽章（`1ST` / `LAST` / `REF`）；首尾幀模式下每張圖與 image asset 旁有角色下拉可調整首幀 / 尾幀。
- **切換模式不會自動清空素材**：不相容的項目會觸發紅色警示橫幅（列出數量與原因），可一鍵「清掉不相容項目」（二次確認）；未清理前生成按鈕停用並顯示阻擋原因。

#### 影片任務生命週期管理

- **可設定的任務最長等待時間**：左側「進階設定」下拉，1 / 2 / 4 / 8 / 24 / 48 / 72 小時（預設 1 小時）。對應 ARK 的 `execution_expires_after`，超過 server 端會自動標 `expired`，不會卡在排隊狀態無限期算配額。
- **狀態 + 即時計時**：每張卡顯示 `排隊中 / 處理中 / 完成 / 失敗 / 已取消 / 已過期`，queued/running 卡片即時跳秒（`mm:ss`），終態凍結在最終時長。`orphaned` chip（⚠ 無法查詢）出現代表此任務由其他金鑰建立、現在這把金鑰沒權限查詢。
- **失敗提交保留**：`createVideoTask` 送出失敗（網路錯、參數被拒）也會寫入一筆 `failed` 歷史（合成 taskId），提示詞與請求內容都留著，方便修正後重試。
- **取消 / 刪除按鈕**：`queued` 狀態的「取消任務」呼叫 ARK DELETE → 立即停扣費；終態的「刪除記錄」清前端記錄（ARK 後端記錄 7 天後自動清）。
- **背景輪詢**：App 層 `useBackgroundPoller` 掃 `activeTaskIds`，每個任務一個獨立 loop。間隔採 3 段 backoff（0–30s 用 3s、30s–5min 用 10s、5min+ 用 20s），status 變化時 reset。沒 API key 時暫停（不移除）；401/403 時標 orphan 並停止。
- **重整恢復**：`videoStore` 用 sessionStorage 持久化（per-tab）— 同 tab refresh 後 history、進行中任務、設定都還在；polling 自動恢復。關 tab / 新 tab 起就乾淨，不會洩漏給共用瀏覽器的下一個使用者。
- **參考媒體失效提示**：reload 後參考媒體因 `File` 物件無法序列化變成 stale chip（📎+filename+已失效）；submit 時會 toast 擋下，要使用者移除後重新上傳。

#### 提示詞素材編號

模型會解析 prompt 中的 `[Image 1]` / `[Video 1]` / `[Audio 1]` 等記號，數字依該類型在 `content` 陣列中的出現順序遞增。前端 UI 會即時在每個縮圖右下角顯示對應編號（例如已上傳 2 張圖、再加 1 個 image-type asset → asset 行右側顯示 `[Image 3]`），不需要手動數。

**一鍵插入**：縮圖右下角的徽章和 Asset 參考 row 右側的 `[Type N]` 都是按鈕 — 點下去會把對應字串插入到提示詞 textarea 的游標位置（前一個字非空白會自動補空白），免手動打或複製貼上。Asset 參考的按鈕在欄位內容是有效形式時（`asset-xxx` / `asset://...` / `http(s)://...`）才會啟用。

#### 任務匯出 / 匯入（瀏覽器端 zip bundle）

匯出**完全在瀏覽器內以 zip 打包**（fflate），server 不落地任何檔案：

- 單任務「匯出 .zip」（卡片 ⋯ 選單，所有非排隊狀態皆可匯出）：`task.json`（完整 request / result，媒體 URL 改寫為 zip 內相對路徑）+ `output/video.mp4` + `output/last_frame.png` + `references/ref-N.*`（所有參考素材）。下載失敗的素材會被排除並記在 `task.json` 的 `missing` 欄位。
- 「匯出全部 (N)」批次 zip：每任務一個 `<taskId>/` 子資料夾；跨任務重複的參考素材去重到頂層 `_shared/` 共用。
- 遠端素材（BytePlus 簽名 URL）經 server 的 `/local-api/download-asset` 代理抓取（見「系統設計重點」），所以匯出 / 下載 mp4 / 下載尾幀都需要本機 server 在跑。
- 「📥 匯入」接受拖入 zip 或整個資料夾（可多份）：媒體轉成記憶體內 `blob:` URL 回放（重整即失效），卡片標「📥 已匯入」，重複 taskId 自動略過。

#### 多模態參考上傳（安全設計）

影片 / 音訊不使用 base64 inline（Seedance 影片不支援；音訊 base64 上限 64 MB），改走 **TOS pre-signed URL**：

```
Browser ──① POST /local-api/tos/sign-put──▶ Express server（瀏覽器隨請求帶 TOS creds）
        ◀── PUT pre-signed URL（15 分鐘有效）─
        ──② PUT file ────────────────────────▶ TOS bucket
        ──③ POST /local-api/tos/sign-get ───▶ Express server
        ◀── GET pre-signed URL（3 小時有效）─
        ──④ POST /api/v3/contents/...──────▶ Seedance（用 GET URL 拉影片）
```

AKSK 由瀏覽器隨請求帶到 Express server 做簽章，server 簽完即丟、不持久化。GET URL 過期後物件不再具備 public access。

### 影片生成 2.5 頁（`/video-25`，Seedance 2.5）

Seedance 2.5 的**獨立頁面**（`/video` 保持 2.0 規格不變），從頂部 tab「**影片生成 2.5**」進入。`model` 取推論憑證的「影片生成接入點 (Seedance 2.5)」，**該欄位留空時直接以 Model ID `dreamina-seedance-2-5-260628` 呼叫**（所以只填 API Key 就能用這一頁）。任務生命週期、背景輪詢、預覽、zip 匯出 / 匯入與 2.0 頁共用同一套機制（state 走獨立的 sessionStorage key），以下只列與 2.0 頁的差異。

#### 2.5 規格與參數鎖定

| 項目 | 2.5 頁的值 |
|---|---|
| 生成模式 | 首幀 / 首尾幀 / 多模態（預設多模態），與 2.0 相同 |
| 多模態參考上限 | 圖片 **0–30** 張、影片 **0–10** 段、音訊 **0–10** 段（影 / 音各單段 2–30 秒、總長 ≤ 30 秒）；**支援純音訊輸入**（不必配圖或影片） |
| 解析度 | 480p / 720p（**無 1080p**） |
| 影片長度 | 4–30 秒，或 `Auto`（模型自選，**2.5 頁預設值**） |
| 畫面比例 | 多模態可自選；**首幀 / 首尾幀模式自動鎖 `adaptive`**（官方規定跟隨首幀圖比例），下拉停用 |

- **提示詞素材標籤用 `@Image1` / `@Video1` / `@Audio1` 形式**（2.0 頁是 `[Image 1]`）；縮圖角標一鍵插入的行為與 2.0 相同。
- 影片 accept `mp4 / mov`、音訊 accept `wav / mp3`；圖片仍以 base64 送出，30 張上限下請留意單次請求 ≤ 64 MB。

#### 提示詞優化開關

提示詞輸入框下方常駐 **提示詞優化** toggle（預設關，per-tab 記住）：

- **開啟後按「生成影片」不會直接建任務**：先用推論憑證的**文字生成接入點**（Seed LLM）依官方 Seedance 2.5 提示詞指南改寫提示詞，按鈕轉「優化中…」，完成後跳出預覽 Modal。
- Modal 內是**可編輯**的優化結果 + 偵測到的任務類型徽章 + 可展開的原文對照，三個出口：〔取消〕〔用原文生成〕〔確認生成〕。優化進行中也能離開（取消鍵或 `Esc`），會中止進行中的 LLM 請求。
- 優化失敗（LLM 錯誤 / 逾時）→ Modal 顯示錯誤 +〔重試〕〔用原文生成〕〔取消〕，**絕不靜默送出**。
- **任務類型參數自動修正**：官方對影片編輯 / 延長任務有參數鎖定（違規會回非同步的 `InvalidParameter.TaskTypeConstraint`），所以偵測為**編輯**任務時長度改 `Auto`、比例改 `adaptive`，**延長**任務只改比例。修正在〔確認生成〕與〔用原文生成〕**兩條路徑都會套用**（API 是依提示詞內容 + 素材 role 分類任務，送原文一樣可能被判為編輯任務），並以 toast 說明、同時寫回左側參數面板。
- 開關 ON 但沒填文字生成接入點 → 生成按鈕停用，原因顯示「提示詞優化需要文字生成接入點」。
- 經過優化的任務，歷史卡片標「已優化」徽章，滑鼠移上去可看原始提示詞（走〔用原文生成〕的任務不算優化、不會標）。

### 圖片生成頁（`/image`，Seedream）

打 `POST /api/v3/images/generations` 同步 API（回應直接帶圖片 URL，無輪詢），使用推論憑證的「圖片生成接入點」。

**模型版本**下拉切換四種能力檔位（選項與限制會自動鎖定）：

| 模型 | 解析度檔位 | 輸出格式 | 組圖 | 參考圖上限 |
|---|---|---|---|---|
| Seedream 5.0 Pro（預設） | 1K / 2K | png / jpeg | ❌ | 10 |
| Seedream 5.0 Lite | 2K / 3K / 4K | png / jpeg | ✅ | 14 |
| Seedream 4.5 | 2K / 4K | jpeg（鎖定） | ✅ | 14 |
| Seedream 4.0 | 1K / 2K / 4K | jpeg（鎖定） | ✅ | 14 |

- **三種生成方式**：文生圖（無參考圖）、圖生圖（1–N 張參考：拖放上傳 + 圖片 URL 列混用，上傳檔轉 base64、URL 直接送）、**組圖**（sequential）— 開啟後送 `sequential_image_generation: auto`，張數上限自動 clamp 到 `15 − 參考圖數`。
- **尺寸雙模式**：`檔位`（解析度檔位 + 比例下拉，比例以自然語言附加到 prompt — 官方建議做法）或 `自訂像素`（寬 / 高輸入，即時驗證模型的像素總數範圍）。
- 其他參數：輸出格式 png / jpeg、AI 浮水印開關（預設關）。
- **`image N` 一鍵插入**：每個縮圖角標與 URL 列旁的按鈕會把 `image N` 插到 prompt 游標處，編號與送出順序一致（上傳在前、URL 在後）。
- **輸出 URL 一鍵複製**：預覽區有 URL 面板（複製 / 開啟），可直接貼到影片頁當參考圖串接圖生影片；歷史卡片也有「複製 URL」（多張以換行合併）。
- **歷史卡片除錯資訊**：從卡片 ⋯ 選單開啟「除錯資訊」展開區塊，顯示 Request ID（可複製）、API 實際回傳模型名、逐張尺寸 / 格式 / URL、token 用量、失敗錯誤碼（含組圖逐圖錯誤）。
- **URL 24 小時到期倒數**：卡片顯示剩餘時間，過期卡整體降透明度、標「已過期」並停用預覽 / 下載，另提供常駐「載入參數重生成」。
- 歷史卡片常駐「下載」「複製 URL」，其餘動作（zip 匯出 / 載入參數 / 刪除（二次確認）/ 除錯資訊）收在 ⋯ 選單；工具列支援全部匯出與 zip 匯入；state 同樣 sessionStorage per-tab 持久化。

### 文字生成除錯頁（`/chat`，Seed LLM）

除錯導向的對話 UI，使用推論憑證的「文字生成接入點」。左側參數面板 + 右側對話區（工具列 / 訊息列表 / 輸入框）。

- **雙 API 模式**（開始對話後鎖定，「新對話」解鎖）：
  - **Chat API**（`/api/v3/chat/completions`）— 無狀態，每輪重建完整 `messages` 歷史送出
  - **Responses API**（`/api/v3/responses`）— 有狀態多輪：首輪送 `input`，後續只送新輸入 + `previous_response_id` 串接 server 端上下文
- **串流 / 非串流**切換：串流走 SSE（fetch + ReadableStream），量測 **TTFT**（首個 token 延遲）並保留完整 chunk log；Chat 串流自動帶 `stream_options.include_usage` 取回 usage。
- **系統提示**：Chat 模式注入為首則 `system` 訊息；Responses 模式可選注入方式 — `system`（僅首輪注入、對隱性快取友善）或 `instructions`（每輪都送、會犧牲快取命中）。
- **參數面板**（留空 = 用 API 預設值）：temperature、top_p、max tokens、深度推理（thinking）、reasoning effort、推論模式（`service_tier`，僅 Chat 模式、每次請求可改）、串流開關。
- **每輪除錯面板**（訊息下方摘要 pill 可展開）：
  - Token：prompt / completion / reasoning / total / **cached_tokens 含快取 HIT / MISS 徽章**（未達 1024 token 隱性快取門檻時附提示）
  - 延遲：TTFT、總耗時、tokens/sec、送出時間
  - Metadata：request id（可複製）、model、service_tier、finish_reason；Responses 模式另有 response id、expire_at、incomplete_reason
  - Raw 區塊（皆可一鍵複製 JSON）：request body、response body、SSE chunk log、錯誤 body
  - **伺服器端動作**（Responses 模式）：查看伺服器上下文（`GET /responses/{id}/input_items`）、檢視 response、刪除 response（二次確認）
- **工具列統計**：目前上下文 token、累計 token、**快取命中率**、輪數；另有全部展開 / 收合、下載對話除錯 JSON（含參數 / 系統提示 / 所有輪次與統計，不含 API key）、新對話。
- **訊息操作**（hover 顯示）:每則使用者訊息可複製 / ✎ 編輯重送 / 🗑 刪除（皆從該輪截斷後續）；最後一輪可 ↻ 重送；助手回應可複製。
- **失敗輸入不丟失**：請求失敗時自動把輸入還原到輸入框（不覆蓋你已打的新字）。
- 對話 sessionStorage per-tab 持久化；重整時進行中的請求標為「已中斷」（保留部分輸出）。

### 私有素材庫管理頁（`/assets`）

從頂部 tab「**私有素材庫管理**」進入，可以：

- 列出 / 搜尋既有 Asset Group 與 Asset（Image / Video / Audio）
- 建立 Asset Group（首次使用可以先建一個 `default` 試試）
- **群組清單無限捲動**：側欄初始只載入第 1 頁（100 筆 + 伺服器回報的總數），捲近底部（~200px）自動接上下一頁並去重；清單底部依狀態顯示載入中 spinner／「已載入 N / M」／失敗時「載入更多失敗，點擊重試」三態之一。取代先前「一次抓完所有分頁（上限 1000 個）」的全量走訪——大型帳戶（數千個群組）在該走訪 + 逐群組 count 扇出下會短時間打出大量請求，觸發 ARK OpenAPI 的流控（見下方「流控自動重試」）
- **群組搜尋**：側欄頂端有搜尋框（sticky，捲清單時不會被捲走）。已載入筆數 < 伺服器回報總數時（清單尚未捲完）自動改走伺服器端 `Name` 搜尋（輸入 debounce 300ms，取前 100 筆，零筆符合時顯示「無符合群組」，不觸發無限捲動）；清單已全部載入完（小帳戶）則在前端即時過濾（不分大小寫的包含比對）。清空搜尋框會重新載入第 1 頁、重置捲動累積
- **選中群組的素材數**：不再逐列顯示徽章；選取群組時單發一次 count 查詢，顯示於主面板標題旁「N 個素材」，查詢中或未選取時顯示 `—`
- **批次刪除群組**：側欄標題列的「管理」切進管理模式，每列出現 checkbox，底部操作列為 全選（目前可見的）/ 清除 / 刪除選取 (N)；勾選在搜尋過濾下保留，可跨多次搜尋累積（管理模式下單列的重新命名 / 刪除選單與「建立新 Group」入口會隱藏）。確認框列出將刪除的群組名稱（超過 12 個顯示「…等共 N 個群組」）並要求輸入「刪除」二字才能按下「永久刪除」，**群組內所有素材會一併永久刪除，不可復原**；刪除以 4 QPS 逐一呼叫 DeleteAssetGroup，全數成功才清空勾選並離開管理模式，失敗項保留勾選可直接重試（取消確認框則勾選原樣保留）；完成後搜尋顯示中會重跑當前查詢，否則重新載入第 1 頁
- 上傳檔案（先進 TOS pre-signed PUT，再以 12 小時 GET URL 給 ARK 的 `CreateAsset`，背景每 5 秒輪詢 `GetAsset` 直到 Active / Failed）
- **狀態視覺化**：卡片右上角依 Asset 狀態顯示統一 StatusPill — Processing「處理中」膠囊（帶 spinner）、Failed「失敗」膠囊 + 警示 placeholder；Active 為正常態不加標記
- **狀態過濾**：類型 chips（全部 / 圖片 / 影片 / 音訊，含計數）旁有狀態下拉（全部 / Active / Processing / Failed），server-side 過濾
- **背景輪詢**：列表上的 Processing 資產每 5 秒自動 poll → 終態時自動翻成 Active / Failed，不用手動 refresh
- **批次刪除**：卡片 checkbox 多選後，底部浮出動作列（已選 N / 全選本頁 / 清除 / 刪除 N 個）；刪除以 ≤8 QPS 節流逐一呼叫 DeleteAsset（transient 錯誤指數退避重試、404 視為成功、400/403 整批中止），進度以單一 toast 就地更新，失敗項可查看詳情並重試
- 重新命名 Asset / Asset Group；級聯刪除 Asset Group（需輸入完整名稱二次確認）
- 點縮圖開預覽抽屜（影片用 `preload=metadata`，按 play 才下載）；抽屜的「基本資訊」區塊也有狀態欄位
- 一鍵複製 `asset://asset-xxx` URI，回到「影片生成」頁貼到「Asset 參考」即可使用

注意事項：

- ARK Asset API 採 **AK/SK 簽章**（`server/routes/asset.ts` 在 server 端做 HMAC-SHA256 v4）；瀏覽器只打 `/local-api/asset/*`，密鑰不進前端。
- 上傳的 12 小時 GET URL 是給 ARK 用的內部 URL；UI 預覽用的 URL 來自 `ListAssets / GetAsset`，同樣 12 小時，每次重整頁面會重抓。
- DeleteAssetGroup 會**級聯刪除組內所有資產**，不可復原（單筆刪除要輸入完整群組名稱、批次刪除要輸入「刪除」二字）。
- 群組清單改無限捲動累積，理論上無上限。第 1 頁（初次載入）失敗時整頁接管成錯誤畫面（僅限「完全沒有群組可顯示」——連伺服器回報的總數都是 0）；「載入更多」（第 2 頁起）失敗則已載入的清單保留可正常操作，僅在側欄底部顯示行內重試列。
- **流控自動重試**：`ListAssetGroups`（含分頁 / 搜尋）與逐群組 count 查詢遇到 ARK 的流控回應（HTTP 429，或錯誤碼含 `throttl` / `ratelimit`〔不分大小寫〕或 `FlowLimit`〔區分大小寫，例如 `AccountFlowLimitExceeded`〕）會自動指數退避重試（最多 3 次，0.5s / 1s / 2s + 隨機抖動）；批次刪除遇到流控會重試該筆而非中止整批。`FlowLimit` 刻意用區分大小寫比對——不分大小寫會連同配額用盡（永久性、非流控）的 `WorkflowLimitExceeded` 一起誤判成可重試。
- `CreateAsset` 一律送 `Moderation = { Strategy: "Skip" }`（先在 console 關閉 Secure Mode）。

---

## 可用指令

```bash
# 開發 / 建置
npm run dev              # concurrently 跑 Vite (5173) + Express (3000)
npm run dev:vite-only    # 僅 Vite，假設 Express 已另外啟動
npm run server:dev       # 只跑 Express dev server (tsx watch)
npm run server:start     # production: NODE_ENV=production tsx server/index.ts
npm run build            # tsc -b && vite build
npm run preview          # 預覽生產版本
npm run lint             # ESLint 檢查

# 測試（vitest + jsdom + Testing Library）
npm test                 # 跑全部測試
npm run test:watch       # watch 模式

# TOS bucket 設定（通常不需要手動跑 — UI 驗證 TOS 憑證時會自動 bootstrap CORS）
npm run tos:bootstrap    # 手動套用 CORS rule（idempotent；需要 .env.local 中的 TOS AKSK）
npm run tos:cors:show    # 印出目前 bucket 的 CORS 設定（純讀；需要 .env.local 中的 TOS AKSK）

# 真實 API 驗證腳本（⚠️ 消耗真實生成額度；僅手動執行、不進 CI；讀 .env.local 的 API_KEY 與對應 endpoint）
npm run verify:frame-roles   # Seedance frame-role schema 驗證（首幀 / 首尾幀 happy path + mutex 違規預期 400）
npm run verify:seedream      # Seedream 圖片 API 驗證（文生圖 / 自訂像素 / URL 與 base64 參考圖 / 負面案例）
npm run verify:chat          # Chat / Responses API 驗證（非串流 / 串流 / previous_response_id / 隱性快取探測；可 -- --case N 跑單一案例）
npm run verify:cache         # ModelArk 隱性 context cache 實測探針（warmup / 延遲階梯 / 對話成長，印 HIT/MISS 總表）
```

---

## 專案結構

```
byteplus-ai-gen-platform/
├── scripts/
│   ├── tos-bootstrap.ts            # 透過 TOS AKSK 設定 bucket CORS（npm run tos:bootstrap）
│   ├── verify-frame-roles.ts       # Seedance frame-role 真實 API 驗證
│   ├── verify-seedream.ts          # Seedream 圖片真實 API 驗證
│   ├── verify-chat.ts              # Chat / Responses 真實 API 驗證
│   ├── verify-cache.ts             # 隱性 cache 命中條件實測
│   └── loadDotenv.ts               # 共用 .env / .env.local 載入器
├── server/                         # Express 後端
│   ├── index.ts                    # entry: load env + listen
│   ├── app.ts                      # createApp() 工廠 — origin guard + 掛載所有 router
│   ├── config/env.ts               # PORT / BIND_HOST / PLATFORM_ORIGIN 載入與驗證
│   ├── signers/
│   │   ├── tos.ts                  # TOS pre-signed URL 純邏輯
│   │   ├── tosCors.ts              # TOS bucket CORS merge / 驗證邏輯
│   │   └── asset.ts                # ARK Asset HMAC v4 簽章純邏輯
│   └── routes/
│       ├── tos.ts                  # POST /local-api/tos/sign-put | /sign-get
│       ├── tosVerify.ts            # POST /local-api/tos/verify（BYO 憑證驗證 + CORS bootstrap）
│       ├── asset.ts                # POST /local-api/asset/*（catch-all dispatch）
│       ├── assetVerify.ts          # POST /local-api/asset/verify（ARK 憑證驗證）
│       ├── localApi.ts             # POST /local-api/download-asset（SSRF allow-list 下載代理）
│       ├── arkProxy.ts             # /api/* → ark.ap-southeast.bytepluses.com
│       └── spaFallback.ts          # production: 服務 dist/ + index.html fallback
├── vite.config.ts                  # Vite 設定 + /local-api、/api proxy 到 Express (3000)
├── docs/
│   └── superpowers/                # 開發計畫 / 規格文件（plans/, specs/）
├── src/
│   ├── api/
│   │   ├── client.ts               # axios 實例 + 自動帶 API Key
│   │   ├── video.ts                # Seedance 任務 CRUD + 輪詢
│   │   ├── image.ts                # Seedream 圖片生成（同步 API + x-request-id）
│   │   ├── chat.ts                 # Chat Completions API（串流 + 非串流 + request body 組裝）
│   │   ├── responses.ts            # Responses API（previous_response_id 多輪、retrieve / input_items / delete）
│   │   ├── sse.ts                  # SSE parser + 串流 POST helper（fetch + ReadableStream）
│   │   ├── asset.ts                # ARK Asset 庫前端 client（走 server/routes/asset.ts）；群組清單走無限捲動分頁、流控自動重試
│   │   ├── groupCount.ts           # 選中群組 count 的共用 guarded fetcher（跨頁面/上傳 hook 共用同一份序號保護）
│   │   ├── batchDelete.ts          # 資產批次刪除 orchestrator（≤8 QPS + 退避重試）
│   │   ├── exportBundle.ts         # 影片任務 zip 匯出（單筆 / 批次 + _shared 去重）
│   │   ├── importBundle.ts         # 影片任務 zip / 資料夾匯入（blob URL + revoke 管理）
│   │   ├── imageBundle.ts          # 圖片任務 zip 匯出 / 匯入
│   │   ├── tos.ts                  # 前端 TOS client（走 server/routes/tos.ts）
│   │   ├── verify.ts               # 前端憑證驗證 client（走 tosVerify + assetVerify）
│   │   ├── local.ts                # 前端對 /local-api/download-asset 的 client
│   │   ├── arkConstants.ts         # ARK API 常數
│   │   └── fileUtils.ts            # base64 轉換（圖片用）
│   ├── components/
│   │   ├── layout/                 # AppLayout / Header（五分頁 + 憑證膠囊）
│   │   ├── common/
│   │   │   ├── ResizeHandle.tsx    # 欄位拖拉縮放 handle
│   │   │   ├── ConfirmModal.tsx    # 危險操作二次確認 modal
│   │   │   ├── ActionPillBar.tsx   # 底部浮動批次動作列（素材庫多選用）
│   │   │   └── ToastProgress.tsx   # 就地更新的進度 toast（批次刪除用）
│   │   ├── credentials/            # Header pills + 右側 Drawer 憑證 UI
│   │   │   ├── schema.ts           # CREDENTIALS 常數（推論 / 素材庫 / TOS 三組定義）
│   │   │   ├── envImport.ts        # .env 解析 + 憑證別名對映
│   │   │   ├── useEnvDrop.ts       # drawer 開啟時拖入 .env 匯入
│   │   │   ├── uiStore.ts          # drawer open + target + expandedSection（無持久化）
│   │   │   ├── HeaderStatusPills.tsx / CredentialsDrawer.tsx
│   │   │   └── CredentialSection.tsx / CredentialForm.tsx
│   │   ├── video/
│   │   │   ├── VideoGenPage.tsx    # 三欄佈局
│   │   │   ├── VideoParams.tsx     # 左側參數面板（生成模式、角色下拉、不相容橫幅、seed）
│   │   │   ├── VideoPreview.tsx    # 中間預覽（無 autoplay）
│   │   │   ├── VideoHistory.tsx    # 右側任務紀錄 + zip 匯出 / 匯入
│   │   │   └── MediaUploader.tsx   # 拖拽上傳 + 縮圖 + 可點 [Type N] 徽章
│   │   ├── video25/                # Seedance 2.5 頁（copy-fork，共用 video/ 的預覽 / 歷史 / uploader）
│   │   │   ├── Video25GenPage.tsx  # 三欄佈局（獨立欄寬 storage key）
│   │   │   ├── Video25Params.tsx   # 2.5 參數面板（480p/720p、Auto+4–30 秒、@Image1 標籤、優化開關）
│   │   │   └── PromptOptimizeModal.tsx  # 優化結果預覽：可編輯 + 取消 / 用原文 / 確認生成
│   │   ├── image/
│   │   │   ├── ImageGenPage.tsx    # 三欄佈局（參數｜預覽｜歷史）
│   │   │   ├── ImageParams.tsx     # 模型 / 尺寸雙模式 / 參考圖 / 組圖 / image N 插入
│   │   │   ├── ImagePreview.tsx    # 單圖與組圖 grid、lightbox、URL 複製面板
│   │   │   └── ImageHistory.tsx    # 歷史卡片：到期倒數、除錯資訊、zip 匯出入
│   │   ├── chat/
│   │   │   ├── ChatPage.tsx        # 雙欄佈局（參數｜工具列 / 訊息 / 輸入框）
│   │   │   ├── ChatParams.tsx      # API 模式、系統提示 + 注入方式、取樣 / 推理參數
│   │   │   ├── ChatToolbar.tsx     # 對話統計 + 展開全部 / 下載 JSON / 新對話
│   │   │   ├── MessageList.tsx / MessageBubble.tsx  # 訊息列表 + 單輪泡泡（複製 / 編輯 / 刪除 / 重送）
│   │   │   ├── TurnDebugPanel.tsx  # 每輪除錯（token / 延遲 / metadata / server 端動作 / raw JSON）
│   │   │   └── useTurnActions.ts   # 編輯 / 刪除的截斷邏輯 + 確認狀態
│   │   └── assets/                 # 私有素材庫管理頁（/assets）
│   │       ├── AssetLibraryPage.tsx  # 整頁佈局 + 過濾 chips + 批次刪除 + 背景輪詢
│   │       ├── AssetGroupSidebar.tsx / AssetGrid.tsx / AssetCard.tsx
│   │       ├── AssetTypeFilterChips.tsx / AssetStatusFilterChips.tsx
│   │       ├── AssetPreviewDrawer.tsx / AssetUploadDialog.tsx
│   │       └── AudioWaveformDecoration.tsx / UploadProgressPanel.tsx
│   ├── hooks/
│   │   ├── useVideoGeneration.ts   # 建任務 + 模式相容 guard + 失敗提交保留（不 await polling）
│   │   ├── useVideo25Generation.ts # 2.5 建任務：prepare / submit 兩段（承接優化流程）+ endpoint fallback
│   │   ├── useImageGeneration.ts   # 圖片同步生成流程 + request 組裝 + 阻擋原因
│   │   ├── useChatGeneration.ts    # 送出 / 重送 / 中止、串流累積、TTFT / 總耗時量測
│   │   ├── useBackgroundPoller.ts  # App 層常駐：3-tier backoff、auth-pause、orphan 偵測
│   │   ├── useNow.ts               # 1 秒 ticker（live mm:ss elapsed 計時用）
│   │   ├── useReferenceUpload.ts   # 影片 / 音訊收檔即上傳 TOS（id-based 容錯）
│   │   ├── useAssetUpload.ts       # /assets 頁的並行上傳（最多 8 條）+ CreateAsset 輪詢
│   │   ├── useAssetStatusPoller.ts # 背景輪詢 Processing 資產（5s）
│   │   ├── useAssetJobToasts.tsx   # 批次刪除進度 toast + 失敗詳情 / 重試
│   │   └── useResizableWidth.ts    # 欄寬拖拉持久化 hook
│   ├── stores/
│   │   ├── authStore.ts            # API Key / 四個接入點 / AssetCreds / TosCreds + verifyState（sessionStorage，v8）
│   │   ├── videoStore.ts           # 影片參數 / 生成模式 / 參考素材 / 任務歷史（sessionStorage）
│   │   ├── video25Store.ts         # 2.5 頁同型 state（獨立 persist key + promptOptimize 開關）
│   │   ├── imageStore.ts           # 圖片參數 / 參考圖 / 歷史（sessionStorage）
│   │   ├── chatStore.ts            # 對話輪次 / 參數 / 系統提示 / 草稿（sessionStorage，重整中斷標記）
│   │   └── assetStore.ts           # /assets 頁的 group / asset 列表狀態
│   ├── types/                      # index.ts（影片）、image.ts、chat.ts、asset.ts
│   ├── utils/
│   │   ├── videoMode.ts            # 生成模式預設角色 + 相容性計算
│   │   ├── seedreamModels.ts       # Seedream 四模型能力表 + 尺寸驗證
│   │   ├── chatStats.ts / chatExport.ts  # 對話統計 / 除錯 JSON 匯出
│   │   ├── contentLabels.ts        # [Image N]（2.0）/ @Image1（2.5）編號計算
│   │   ├── sd25PromptOptimizer.ts  # 2.5 提示詞優化：system prompt 組裝 / JSON 解析 / 任務類型參數修正
│   │   ├── mediaValidation.ts      # 影片 / 音訊 / 圖片格式與大小驗證
│   │   ├── tosRegions.ts / tosBucket.ts  # region → endpoint、bucket/prefix 解析
│   │   └── panelScale.ts / clipboard.ts
│   ├── __tests__/                  # vitest + jsdom 測試（執行 `npm test` 看當前數量）
│   ├── App.tsx                     # 路由：/video /video-25 /image /chat /assets
│   ├── main.tsx
│   └── index.css                   # 深色主題樣式
├── .env.example                    # 環境變數範本（commit）
└── .env.local                      # 真實值（git 排除）
```

---

## 系統設計重點

### `server/app.ts` — Origin guard

`/local-api` 與 `/api` 都掛了 origin guard：帶 `Origin` header 的請求必須等於 `PLATFORM_ORIGIN`（預設 `http://localhost:5173`；dev 模式額外接受 `localhost` ↔ `127.0.0.1` 等價寫法），否則回 403。搭配預設只綁 loopback（`BIND_HOST=127.0.0.1`），防止其他來源的網頁誘使本機 server 用使用者的 AKSK 簽章或代理下載。無 Origin 的請求（CLI script、測試）放行。

### `server/routes/tos.ts` + `tosVerify.ts`（簽章邏輯在 `server/signers/tos.ts`，CORS 邏輯在 `server/signers/tosCors.ts`）
Express 上掛 `/local-api/tos/*` 三個 endpoint：
- `POST /sign-put` 接收 `{ filename, contentType, creds }`，回 PUT pre-signed URL（15 分鐘有效）+ 物件 key
- `POST /sign-get` 接收 `{ key, expiresSec?, creds }`，回 GET pre-signed URL（預設 3 小時，上限 7 天）
- `POST /verify` 接收 `{ creds }`，驗證 TOS 憑證是否有效（headBucket），並自動將當前 origin merge 進 bucket 的 CORS 規則（idempotent）

物件 key 格式：`${keyPrefix}${YYYY}/${MM}/${uuid}-${sanitized-filename}`，由 server 端組（client 不能任意指定 key）。`keyPrefix` 由前端 `parseBucketAndPrefix` 從 Bucket 欄位拆出（純 bucket → `seedance-2-0/` 預設；`mybucket/foo` → `foo/`）。所有 endpoint 的 AKSK 都由瀏覽器隨請求帶入（BYO 模式），server 不持久化；`endpoint` 也在 server 端透過 `withDerivedEndpoint`/`deriveEndpoint` 從 region 推導，不必由 client 帶。

### `server/routes/asset.ts`（簽章邏輯在 `server/signers/asset.ts`）
Express 上掛 `/local-api/asset/*`，把瀏覽器請求轉發到 `ark.ap-southeast-1.byteplusapi.com`，並用 ARK 那組 AKSK 在 server 端做 **HMAC-SHA256 v4 簽章**。瀏覽器只看到 `/local-api/asset/*`，AKSK 與 ProjectName 不會進前端。涵蓋的 ARK Asset Open API：`ListAssetGroups` / `CreateAssetGroup` / `DeleteAssetGroup` / `ListAssets` / `CreateAsset` / `GetAsset` / `DeleteAsset`。

### `server/routes/localApi.ts` — 下載代理
現在只有一個 endpoint：`POST /local-api/download-asset`。無狀態、**SSRF allow-list** 的下載代理（只允許 https、拒絕 IP 字面位址與自訂 port、host 必須屬於 `bytepluses.com` / `byteplus.com` / `volces.com`），120 秒 timeout、串流回傳、`Content-Disposition: attachment`。供影片 zip 匯出、mp4 / 尾幀下載、圖片下載共用；**不再有 server 端 `exports/` 檔案落地**（舊的 export / import / list-exports 端點已隨多用戶隔離重構移除，匯出改為瀏覽器端 zip）。

### `useReferenceUpload`
影片 / 音訊上傳採 **id-based 索引**，每個項目進 store 時帶一個 `crypto.randomUUID()`。當 promise 完成時用 id 找回對應項目，使用者中途移除 / 新增不會污染其他項目。

### `useVideoGeneration`
- **Create-only 流程**：建任務 + push `taskId` 到 `activeTaskIds` + 寫 queued history entry，**不 await polling**（由 `useBackgroundPoller` 接手）
- 送出前用 `computeCompatibility` 做**生成模式 mutex guard**（與 UI 的不相容橫幅同一套邏輯）；圖片 role 寫入 content item（影片固定 `reference_video`、音訊固定 `reference_audio`）
- 帶 `execution_expires_after` 給 ARK（從 `videoStore.executionExpiresAfter` 讀取）
- 影片 / 音訊一律使用 `media.uploadedUrl`（不 fallback 到 base64，因 Seedance 影片不支援）
- 參考素材尚未完成上傳、或重整後變 stale 時拒送並 toast 提示
- `createVideoTask` 拋錯時寫入合成 `failed` 歷史（`local-failed-...` taskId），失敗的提交不會消失
- `content` 陣列順序固定為 `[text, …images, …videos, …audios, …assets]`，與 `[Type N]` 編號規則對齊

### `useBackgroundPoller`
App 層 `<App>` 內常駐 mount **一次**（無 cleanup，移到 route 元件會 leak loops）。掃 `videoStore.activeTaskIds`，每個 taskId 一個獨立 polling loop，用 `useRef<Set<string>>` dedupe 避免 re-render 重複起 loop。
- **3-tier backoff**：0–30s 間隔 3s、30s–5min 間隔 10s、5min+ 間隔 20s；status 變化 reset 計時。
- **Auth-pause**：偵測到 `authStore.apiKey` 為空 → sleep 5s 重試（**不移除任務**，等使用者填回金鑰）。
- **Orphan 偵測**：`apiClient` interceptor 把 HTTP status 黏到 Error 物件上；poller 檢查 `err.status === 401 || 403` → 標 `orphaned: true` + `removeActiveTask`。
- **取消 race 防護**：`getVideoTask` resolve 後再檢查 `activeTaskIds.includes(taskId)`，使用者中途取消 → 直接 return，不寫陳舊 history。
- **終態處理**：`succeeded / failed / cancelled / expired` 都會寫 `updatedAt` + 對應欄位（succeeded 寫 videoUrl/lastFrameUrl/seed/resolution/fps；failed 寫 error），然後 `removeActiveTask`。

### Chat 串流（`src/api/sse.ts`）
axios 在瀏覽器無法讀串流，所以串流請求走 `fetch` + `ReadableStream`，自帶 Bearer header。`createSseParser` 處理跨 chunk 邊界的 UTF-8 解碼與 `data:` 行組裝；原始 chunk 全程記錄（中止時保留已收部分），供除錯面板檢視。Chat 與 Responses 的 usage / metadata 分別從 `include_usage` 最終 chunk 與 `response.completed` / `response.incomplete` 事件取回。

---

## 測試

執行 `npm test` 看當前測試結果（檔案數與 case 數會隨開發增加，以實際輸出為準）。主要涵蓋範圍（非完整列表）：

**影片生成模組**

| 檔案 | 範圍 |
|---|---|
| `videoApi.test.ts` | Seedance 任務 CRUD、3 段 polling backoff、timeout 後最後一次 sync 不 throw |
| `videoGeneration.test.ts` | Create-only 流程：寫入 history + 進 `activeTaskIds`、`execution_expires_after`、validation、stale ref 阻擋 |
| `videoMode.test.ts` | 生成模式：`defaultRoleForMode` 與 `computeCompatibility`（各模式圖片數 / role / 影音 / asset 相容性） |
| `videoStore.test.ts` / `videoStorePersist.test.ts` | store actions、預設值、sessionStorage round-trip（refs flatten 為 stale stub） |
| `videoParams.test.tsx` | 左側面板：模式切換、不相容橫幅、duration/ratio 選項、任務最長等待時間下拉 |
| `videoHistory.test.tsx` | 右側面板：imported tag、匯入流程、`已過期` / `無法查詢`、live duration、取消 / 刪除 |
| `videoPreview.test.tsx` | 中間預覽：無 autoplay、有 controls、source 優先順序 |
| `exportBundle.test.ts` / `importBundle.test.ts` | zip bundle manifest 相對路徑改寫；資料夾 / zip 匯入解析 |
| `useBackgroundPoller.test.tsx` | App 層 polling：終態移除、dedupe、401 → orphaned、無金鑰暫停 |
| `useNow.test.ts` | 1 秒 ticker：初值、推進、unmount cleanup |
| `referenceUpload.test.ts` / `mediaUploader.test.tsx` | 上傳 hook 成功 / 失敗 / 併發；拖拽 UI、[Type N] badge、stale chips |
| `mediaValidation.test.ts` / `contentLabels.test.ts` | 素材格式驗證；[Type N] 編號計算 |
| `exportImport.test.ts` | 匯出 payload 結構、匯入解析邏輯 |

**圖片生成模組**

| 檔案 | 範圍 |
|---|---|
| `seedreamModels.test.ts` | 四模型能力表、`validateCustomSize` / `clampMaxImages` 邊界 |
| `imageApi.test.ts` | `generateImages` payload 與回應解析（含 `x-request-id`） |
| `imageStore.test.ts` | store 生命週期、模型切換自動修正、persist stale 標記 |
| `useImageGeneration.test.ts` | request 組裝（文生 / 圖生 / 組圖）、阻擋原因全清單、生成流程 |
| `imageParams.test.tsx` | 表單：模型鎖定、參考圖列增刪、`image N` 插入 |
| `imagePreview.test.tsx` / `imageHistory.test.tsx` | 預覽各狀態、URL 面板；卡片、到期倒數、除錯區、匯出入 |
| `imageBundle.test.ts` | zip 匯出 / 匯入內容與 missing 處理 |
| `imageRoutes.test.tsx` | Header「圖片生成」tab 與 `/image` 掛載 |

**文字生成（Chat）模組**

| 檔案 | 範圍 |
|---|---|
| `sse.test.ts` | SSE parser：跨 chunk UTF-8 解碼、`data:` 行組裝、chunk log |
| `chatApi.test.ts` / `responsesApi.test.ts` | 兩種 API 的 request body 組裝、串流 delta 累積、usage 正規化 |
| `useChatGeneration.test.ts` | 歷史重建、系統提示注入（4 種組合）、失敗輸入還原、previous_response_id、中止 / 重送 |
| `chatStore.test.ts` | 模式鎖定 / 解鎖、`truncateFromTurn`、重整 pending→aborted、v1→v2 migration |
| `chatStats.test.ts` / `chatExport.test.ts` | 統計計算；匯出 bundle 結構 |
| `chatComposer.test.tsx` | Enter / Shift+Enter / IME、憑證缺失導引、生成中的停止按鈕 |
| `chatToolbar.test.tsx` / `chatDebugPanel.test.tsx` | 統計列與動作；除錯面板展開、快取提示、server 端動作、複製按鈕 |
| `chatRoutes.test.tsx` | Header「文字生成」tab、頁面組裝、對話中模式鎖定 |

**私有素材庫模組**

| 檔案 | 範圍 |
|---|---|
| `assetApi.test.ts` / `assetStore.test.ts` / `assetTypes.test.ts` | ARK Asset client、列表 store、型別 / mime 判斷 |
| `assetLibraryPage.test.tsx` / `assetGroupSidebar.test.tsx` / `assetGrid.test.tsx` / `assetCard.test.tsx` | 整頁互動、group 管理、多選 grid、卡片狀態 |
| `assetGroupsPaging.test.tsx` | 分頁累積（初載只打 1 頁、append + 去重、載更多失敗行內重試、初載失敗整頁接管、count 不扇出） |
| `assetGroupInfiniteScroll.test.tsx` | 側欄無限捲動：捲動閾值觸發、載入中 / 失敗重試 / 已載入 N/M 三態 footer、count 徽章已移除 |
| `assetGroupSearch.test.tsx` / `serverGroupSearch.test.tsx` | 側欄前端過濾（清單全載完時）；已載入 < 總數時的伺服器端 Name 搜尋（debounce、重入序號、搜尋顯示中停用捲動、批次刪除收尾重跑查詢 / 重載第 1 頁、重載與載更多的搶跑防護） |
| `assetGroupManage.test.tsx` / `assetGroupBatchDelete.test.tsx` | 管理模式多選（跨搜尋累積、全選範圍）；批次刪除確認 / 失敗留勾 / 重試分流 / 刪掉當前群組時清素材勾選 |
| `assetTypeFilterChips.test.tsx` / `assetStatusFilterChips.test.tsx` | 型別 / 狀態過濾 chips |
| `batchDelete.test.ts` / `flowLimitRetry.test.ts` | 批次刪除：8 QPS 節流、退避重試、404 冪等、400/403 中止；流控錯誤碼（含 `AccountFlowLimitExceeded`）判定與自動重試 |
| `selectedGroupCount.test.tsx` / `groupCount.test.ts` | 選中群組 count：單發、'—' 佔位、切換群組更新；共用 guarded fetcher 的序號保護（同群組競態、跨群組互不干擾） |
| `useAssetStatusPoller.test.ts` / `useAssetUpload.test.ts` | 背景輪詢 hook；並行上傳 + 429 退避 |
| `assetUploadDialog.test.tsx` / `uploadProgressPanel.test.tsx` / `audioWaveform.test.tsx` | 上傳對話框 / 進度面板 / 音訊縮圖 |
| `actionPillBar.test.tsx` / `toastProgress.test.tsx` / `confirmModal.test.tsx` | 共用元件：批次動作列、進度 toast、確認 modal |

**憑證 / 認證模組**

| 檔案 | 範圍 |
|---|---|
| `headerStatusPills.test.tsx` / `credentialsDrawer.test.tsx` / `credentialSection.test.tsx` / `credentialForm.test.tsx` | 三顆膠囊、drawer 容器、accordion section、schema-driven 表單 |
| `authStoreVerify.test.ts` | verifyState slice：setField reset、verify 三條 path |
| `authStoreImageEndpoint.test.ts` / `authStoreTextEndpoint.test.ts` | 圖片 / 文字接入點欄位、「至少一個接入點」驗證 |
| `authStoreMigration.test.ts` | zustand auth store 版本遷移（v1→…→v7）+ localStorage 清理 |
| `envImport.test.ts` / `envImportTextEndpoint.test.ts` | .env 解析、憑證別名對映（含 SEEDREAM / SEED endpoint 分流） |
| `authStoreApplyImportedEnv.test.ts` / `credentialsDrawerEnvDrop.test.tsx` | 匯入的 .env 套用進 store；drawer 拖入 .env 行為 |

**TOS / 本機 API 共用**

| 檔案 | 範圍 |
|---|---|
| `tosClient.test.ts` / `tosBucket.test.ts` / `tosRegions.test.ts` | 前端 TOS client、bucket/prefix 解析、region → endpoint |
| `vitePluginTos.test.ts` / `vitePluginAsset.test.ts` | 純函式：TOS 簽名 / TTL 邊界；ARK HMAC v4 簽章 |
| `tosBootstrap.test.ts` / `tosCorsMerge.test.ts` | bootstrap script；CORS merge idempotent |
| `localApi.test.ts` | download-asset client（並確認舊 export / import 端點已移除） |

**Server 端路由（Express + supertest）**

| 檔案 | 範圍 |
|---|---|
| `serverOriginGuard.test.ts` | origin guard：403 / 放行 / loopback 等價 |
| `serverTosRoutes.test.ts` / `serverTosVerify.test.ts` | TOS sign-put / sign-get；verify + CORS bootstrap |
| `serverAssetRoutes.test.ts` / `serverAssetVerify.test.ts` | ARK Asset dispatch；憑證驗證 |
| `serverArkProxy.test.ts` | /api/* → ARK Open API proxy |
| `serverLocalApiRoutes.test.ts` | download-asset 代理：SSRF allow-list、streaming |
| `serverSpaFallback.test.ts` | production SPA fallback |

`src/__tests__/setup.ts` 內含 in-memory `localStorage` 與 `sessionStorage` polyfill，確保在 Node 25 + jsdom 環境下 zustand `persist` middleware 不會掛掉。

---

## 部署到生產環境

後端已抽出為獨立 Express server（`server/` 目錄）。生產部署完整教程：

- [`docs/deployment-guide.md`](docs/deployment-guide.md) — 從 BytePlus VM 0→1（Phase 0 後端抽取已完成；Phase 1 起：VM provisioning、Nginx 反向代理、Let's Encrypt、systemd service、備份）

產品環境啟動：

```bash
npm run build
NODE_ENV=production PORT=3000 npm run server:start
```

Express 同時負責 API 路由與 `dist/` 的 SPA 靜態服務，無需另外跑 Vite。記得依實際網域設定 `PLATFORM_ORIGIN`（origin guard 會擋掉其他來源）。

---

## 後續開發

- [x] 圖片生成（Seedream 模型）— 分頁位置 `/image`，支援文生圖／圖生圖／組圖
- [x] Chat / LLM（Seed 文字生成）— 分頁位置 `/chat`，除錯導向 UI（雙 API 模式 + 快取 / 延遲觀測）
- [ ] 虛擬人模型
- [ ] 語音模型
- [ ] TOS bucket lifecycle 自動清理
- [ ] 上傳前 client-side 影片時長檢查（防 > 15s）
