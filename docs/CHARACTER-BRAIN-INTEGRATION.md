# 米花大舞台 × 上游 GitHub Character Brain

## 來源與權責

- 上游：`https://github.com/day2561124-art/wRITE`，git submodule 鎖定提交 `f6a929162082975ab7800ff7ced02438186c649b`。
- 米花：`https://github.com/day2561124-art/Mi`。
- 不複製上游演算法，也不自行宣稱已實作上游完整 Native Loop。
- 目前接的是 **正式 wRITE 的 direct capability runtime**：`world_perception_filter` → `world_character_cognition` → `world_action_proposer`。
- 這是第一階段 integration bridge。尚未導入 `prepareWorldSimulationTurn`/`runWorldSimulationTurn` 的完整 commit/experience replay；`recovered_memories` 明確為空，不把 legacy memory compatibility projector 誤當真正主觀記憶檢索。
- 角色行動候選來源為米花 World 的地點路網、已知線索與體力約束。World 核心才負責實際位移與存檔，brain 不能自行寫入世界成功結果。
- 目前 `Mi` 的本地規則仍用於離線、補算與上游未啟用狀態，不能宣稱所有 NPC 已由完整 Character Brain 接管。

## 啟動

```bash
git submodule update --init --recursive
npm ci --prefix vendor/wRITE
npm run dev
```

預設只會連上上游 capability runtime，**不會替 NPC 進行線上決策**。上游設計需要由具自主決策能力的 `characterBrain(packet)` provider 選擇候選 action。由服務營運者自行在不提交到 GitHub 的機密環境提供：

```bash
BRAIN_SELECTOR_MODULE=/absolute/path/outside/repo/selector.mjs npm run dev
```

`selector.mjs` 需 `export default async function(packet) { return {action_id:'...'} }`，只能回傳 `candidate_action_intents[].action_id` 或 `reject_all`。可接經授權的 LLM 或本機推論，**不是額外複製一個角色腦**。不要把 API Key、憑證或私有選擇器提交到公開 repo。ChatGPT Plus 本身不等於有 API 額度。

### HTTP 與操作

- `GET /api/brain/status` 僅回傳是否連線及是否有 provider，不含秘密值。
- `POST /api/brain/decide` 僅接受單角色的白名單感知資料及可行行動，發回有驗證的 action ID，不能傳送完整世界狀態；同源檢查、大小上限 20 KB。
- 前端「世界設定」只有連上上游與 provider 才能打開角色腦模式，背景逐一派送少量角色決策；回覆若不符合原世界 ID、時間與當前候選行動則不採納。
- 此接線是實驗性流程，純靜態 GitHub Pages 無法執行 Node.js 上游；需要可執行 Node 服務的部署環境。

## 下一輪整合

1. 將 wRITE Native Loop 的世界 lineage、角色正式 identity 和 committed experience/replay 接上米花持久化資料庫。
2. 完整 NPC 背景思考排程與限額，不把選擇器缺席當成思考成功。
3. 用原生 `Character Brain` 完整回合與 World 因果裁定做多角色長時段對照。
4. 對外部署時新增使用者世界隔離、權限驗證與持久後端，這次 preview 僅綁定本機 `127.0.0.1`。

## Rebuild 0.4: Native 單回合（需明確啟用）

新增 `server/native-brain.mjs`，直接載入 **wRITE 正式**
`beginWorldSimulationSession`、`createWorldSimulationCharacterRuntimeManager`、
`runWorldSimulationTurn`、`getWorldSimulationState`、
`getWorldSimulationHistory` 與 `commitWorldSimulationTurn`，而不是把三個 direct capability
誤當完整 Native 回合。

```bash
# 需預先安裝固定版 vendor/wRITE；BRAIN_SELECTOR_MODULE 須為本機受信任模組
BRAIN_NATIVE=1 BRAIN_SELECTOR_MODULE=/absolute/path/to/selector.mjs npm run dev
```

Native session 對應表只保存在伺服器的 `.beika-private/brain-native-index.json`
（已加入 `.gitignore`），wRITE 自己的世界 history 與角色 Current Mind 延續在
它的 Agent Run 儲存層；回合先採納**單名角色可觀察的場景**，再執行 Native Brain。
同世界重新決策會保留 session，對相同輸入去重，回溯的時間會被拒絕。

**重要權責限制**：目前 Native 回合提交的是合法的「行動意圖」，不是米花實際
已成功抵達、調查完成或產生某個世界後果。遊戲前端仍要以當前候選行動及
世界分鐘重新確認，才會發動米花 World 行為。故此版本尚未完成**米花世界的伺服器
權威提交／反饋 → wRITE 完整 Experience Receipt**。目前這部分不應稱為已完成。
另外，正式雲端服務還需登入授權、使用者世界隔離、多執行個體鎖與伺服器存檔。
本機服務仍僅聆聽 127.0.0.1。

驗證：`npm test` 會檢查本地 Native Mock 的因果邊界、跨重啟 session index、
重複呼叫與錯誤處理。GitHub `Upstream Character Brain Integration` 流程會在
**真正固定版 wRITE checkout** 執行 `tests/brain-native-upstream.test.mjs`；
只有該測試通過，才算原生執行契約通過。

### 本機預覽檔案隔離與部署警告

`npm run dev` 會先建置 `dist/`，HTTP 伺服器只公開此目錄，**不再將整個儲存庫當網站根目錄**。對 `.env`、`.beika-private/`、`server/` 的 HTTP 請求應回傳 404。預覽仍只可在本機開啟；若要公開部署，請先新增帳號權限和每世界隔離。

2026-11-22 真實 GitHub Actions 的 `npm ci` 對目前固定版 wRITE 依賴回報 9 項安全性警告（3 moderate、5 high、1 critical）。此輪未擅自升級其他專案依賴，也**不建議在未審核依賴與權限前將 Native Node 後端公開部署**。


## Rebuild 0.5：本機 World 回饋與下一輪主觀證據

`src/core/brain-feedback.js` 紀錄與世界進程關聯的待回饋行動；`src/core/world.js` 在時間推進與角色行動日誌之後結算，並保留失敗與未完成狀態。`server/native-brain.mjs` 新增 `acknowledge()` 以已提交的 `decision_id` 進行受限、序列化、持久化與去重。HTTP 介面 `POST /api/brain/feedback` 僅在 Native 模式開放，沿用同源檢查與輸入大小限制。接續回合將尚未交付的回報以 `guessed` 候選主觀資訊再次投影給正確角色，完成回合後記錄已使用的事件識別，避免重複交付。

### 重要可信度界線

1. 米花結果由**瀏覽器的本機 World** 推進與保存，伺服器僅檢查回饋是否符合自己先前提出的動作識別、時間範圍與合理結果類型，**沒有獨立重演所有米花世界因果**。
2. 因此回饋使用文字 `本機存檔回報（未經伺服器驗證）`，只進入該角色的 `guessed`，不提升為硬世界真相；絕不繞過 wRITE 的原生編碼、記憶檢索與提交裁定。
3. 這是**已回傳到上游下一回合的主觀線索閉環**，並非完整 `World causal commit -> Native committed Experience Receipt -> longitudinal learning`。要達成完整跨角色長期因果仍須服務端世界權威、post-commit experience authority、衝突處理與重啟恢復驗收。
4. GitHub Actions 使用固定 SHA 的真實上游子模組進行 Native Loop 的兩回合讀取測試；本地沒有子模組時該測試會跳過，不能把跳過計為通過。

## Rebuild 0.6：伺服器權威米花世界（本機單使用者預覽）

本輪新增 `server/world-store.mjs` 與 `src/core/world-api.js`，讓使用者可選擇將世界交由 **Node 服務端**保存，而非要求瀏覽器自行宣告完成的世界事件。`npm run dev` 在 `127.0.0.1:4173` 同時提供靜態頁面和世界 API。

- 在創建世界時勾選「儲存至本機伺服器」，即可建立獨立的伺服器世界。世界存於 `.beika-private/worlds/<id>.json`，**不會上傳 GitHub 或原 Sites**。
- 現有本機世界可從「世界設定」明確選擇移轉。此為一次性、不可覆蓋的建立操作，會保留原本 IndexedDB / localStorage 存檔供使用者備份。
- 原本瀏覽器存檔所帶的 `brainOutcomes` **不會被升格成伺服器驗證的後果**。移轉會清除未認證的角色腦回饋、暫停世界、關閉角色腦開關，並記錄 `historic_client_events_unverified`；歷史劇情／人物資料作為匯入初始狀態保留，但不對先前事件宣稱伺服器曾獨立核實。
- 伺服器只提供固定指令 `advance`、`catchup`、`visit`、`room`、`pause`、`speed`、`canon`、`brain_enabled`。不接受對現有世界的任意 JSON `replace`／`put`。每次指令附 `expected_revision`、`expected_hash` 及 `operation_id`，過期或衝突操作被拒絕。世界狀態採原子檔案替換，單個 Node 程序內序列化。
- 伺服器端的 `/api/worlds/<id>/brain-turn` 直接從自己保存的 World 構造角色感知、取得上游 Native 決定並驗證可行行動，再提交 World。結果仍必須等 World 實際推進、留下日誌才算成立。
- `/api/worlds/<id>/reconcile` 只能由伺服器從**已保存的** `brainOutcomes` 建立回饋，透過內部 `acknowledgeAuthoritative` 通道提交至上游。失敗時保留 ready 狀態，不會冒報已交付。伺服器與瀏覽器使用不同的上游世界識別，避免兩份存檔誤混角色記憶。
- 上游下一回合會取得「米花伺服器已保存並核對的歷史行動紀錄」，和既有「本機存檔回報（未經伺服器驗證）」分開標示；**仍然不是完整 wRITE Native Experience Receipt / 長期學習**。上游記憶形成仍由原生機制自行決定，不能當作自動學到。
- 未啟用上游決策提供者時，世界照常依既有規則推進，不能視為所有 NPC 已由 Character Brain 控制。伺服器不會在沒有使用者連線時自行建立持續監控排程，重新進入時才會補算應有的遊戲時間。

### API 與測試

`GET /api/worlds`、`POST /api/worlds`、`POST /api/worlds/migrate`、`GET /api/worlds/<id>`、`POST /api/worlds/<id>/commands`、`POST /api/worlds/<id>/brain-turn`、`POST /api/worlds/<id>/reconcile`。寫入需 JSON，同源檢查和內容大小限制，伺服器資料不會經由靜態檔案路由曝光。

`npm run check` 覆蓋伺服器重開、操作重播、版本競態、已損壞世界隔離、本地備份保留、客戶端不可竄改已提交世界、回饋中斷重試及實際前端→HTTP→世界儲存流程。GitHub upstream workflow 另用固定版真實 `wRITE` checkout 執行「第一回合 → 世界實際推進 → 已保存的回饋 → 第二回合」測試。

### 安全與尚未完成

此模式**僅為單一可信使用者的 localhost 預覽**，**不是可上公網的多人或雲端服務**：沒有帳號登入、持有人授權、資料加密、跨伺服器檔案鎖、跨裝置同步及完整備份回復；同一資料夾不可由多個 Node 程序同時寫入。正式公開之前必須先實作隔離、認證、備份與依賴安全稽核。原 Sites 仍獨立且未修改。


## Rebuild 0.7：Node 背景 Native 多角色排程

`server/world-scheduler.mjs` 在 `BRAIN_NATIVE=1` 且設定 `BRAIN_SELECTOR_MODULE` 時啟動。每輪從各世界的伺服器存檔讀取最新版本，按照世界與 NPC 的輪替順序，向同一固定版上游發送**各自隔離的感知**，並把合法、已提交的 action ID 交回 `server/world-store.mjs` 執行。世界真相從不交給角色選擇器。單輪每個世界最多三個 NPC；一次 World 時間差最多補 120 遊戲分鐘，避免模型延遲使負荷失控。

使用 `src/core/world.js` 的合法路網與物理步進；新目標僅由 Native 策略提出。等待中或已上路的角色不會重新思考另一個目的地。世界採獨立序列化佇列，並行推進不同世界，任一 NPC 的 provider 錯誤不會阻斷其他人。`brainOutcomes` 仍從伺服器 World 的實際結果產生，先經 `reconcile` 接收並驗證，再由 Native 在新回合重新理解。還不等於 wRITE 正式權威 Experience Receipt，不應當成長期記憶已生成的證據。

前端在伺服器 Native 模式切換為唯讀輪詢進度，避免瀏覽器另外送 `advance` 和單角色決策，與背景排程競逐。如果選擇器服務下線，可在畫面中關閉已啟用的 Native 模式，重新使用原本的作息規則；**不能悄悄替尚未完成的角色腦決策選擇成功結果**。

尚需完成：跨伺服器共享鎖和持久化工作排程、正式上游 Experience Receipt 與 learning 生命週期、崩潰前後的跨系統雙提交對帳、雲端使用者身份與授權、多設備同步及上游依賴安全審核。原 Sites 正式站保持獨立。


## Rebuild 0.8：Native 主觀記憶形成接線（正式記憶引擎）

伺服器確認的行動結果只會在後續**角色專屬的觀察回合**出現，內容是「角色重新查閱自己的歷史行動紀錄」，而非將過去的結果偽裝成當前直接體感。已驗證結果進入 `observable_by` 的角色限定視覺清單，交由上游原有 `Phase63A` 判斷是否形成主觀記憶。舊版未經伺服器驗證的瀏覽器回報仍只在 `guessed`，絕不冒充已編碼記憶或 World 真相。

**資料界線**：Mi 只保存意圖、世界實際結果與已交付事件的識別碼；不手動寫入 wRITE 的 `memories`。上游正式 CI 將讀取自己提交的 World State／history，檢查主觀記憶是否由真正 Native 回合產生、且沒有跨角色洩漏。這一輪只驗證「主觀記憶形成」，不等同於已驗證正式 post-outcome Experience Receipt、Phase63C 真正取回與後續學習。

## Rebuild 0.9：明確且有來源的 Phase63C 記憶檢索

- `server/memory-retrieval.mjs` 加入極窄範圍的 `memoryRetrievalResolver`，只在角色有下一步思考／回想／查證目標時，從 **wRITE 已形成、由該角色專屬記憶候選集提供**的主觀記憶中選取已驗證的米花歷史行動紀錄。來源不是客戶端猜測，更不是自行生成新記憶。
- wRITE Phase63B 控制候選記憶可取回性；此 resolver 只能選該候選集中的既有 `memory_id`，並指定 whole-content selector，不能寫入自由文字；Phase63C 負責實際檢索，Current Mind 負責內容呈現，選擇器只看到最終主觀內容。
- 角色當回合已經正在閱讀同一筆新證據時，不會把這次「閱讀」偽稱為從過去「想起」。原本 wRITE 的回合版本與世界因果提交不被繞過。
- 此策略不是通用人腦聯想機制；只服務米花伺服器已驗證行動紀錄，以確立端到端檢索接線。真正學習是否改變行動，必須由獨立對照測試驗證；所有行動仍需決策提供者實際選擇。
