# 米花大舞台・有命你就來 / 獨立重作

> 這是以已知功能需求與 2026-11-21 第 35 版接續資料 **重新實作** 的新專案，不是 Sites 原始碼匯出，也不是與原正式站逐頁驗證過的複製品。原 Sites 專案保持不動。

- 原正式站：https://beika-stage.merebeacon.chatgpt.site/
- Sites project ID：`appgprj_6affa67227cc8191aeb0a29b451af36a`
- 本儲存庫：https://github.com/day2561124-art/Mi
- 目前套件版本：`0.14.0`（以 `package.json` 為準；上游依賴有後續獨立 PR，未公開部署）

## 已實作

- 建立多個獨立世界，**創建當下立即持久化**；重開可以從世界列表載入。
- IndexedDB 優先、localStorage 備援、JSON 匯出與匯入、明確的保存成功／失敗顯示；兩個存儲層恢復時，按保存時間合併，避免備援的較新存檔被舊版資料覆蓋。
- **Rebuild 0.1 存檔向前相容**：世界 ID、居民與事件進度不會清空，讀檔時自動升級至 schema v2。
- 2D 俯視地圖、三個區域、**20 條相連道路與最短路線**、實際走訪耗時、進入建築觀察室內與記錄在場資訊。地圖點擊只是預覽，只有「走訪」才會改變觀察者位置與世界時間。
- 觀察者與 NPC 分離：玩家不能直接操控 NPC，觀察路徑與房間隨存檔保留。
- 角色作息、體力恢復、道路分段移動、個人意圖、社交互動，以及「現場線索／同地點傳聞 → 個人認知 → 主動查證 → 確認或未證實」的因果日誌。沒有全知廣播；原作事件不會直接傳送到每個角色腦中。
- 獨立原作事件排程（第 883–900 話 11 組 33 階段的標題摘要），每階段只執行一次；不強迫自訂角色介入。資料取自既有交接包，**並非完整作品劇情**。
- 暫停、1×／4×／12×、手動加速、離線補算（最多七天）、世界事件簿。
- 繁體中文介面、桌面與手機響應式佈局。

## 尚未恢復

- 原 Sites 第 35 版前後端、原有完整設定、地圖精確外觀、原有角色與世界資料庫、其他系列完整事件、真實玩家存檔。
- 正式原作事件的精確場景 ID、**Sites 原站舊存檔轉換**（目前僅支援 Rebuild 0.1 JSON）、跨作品完整角色與世界資料、真正成熟的長期角色腦、雲端跨裝置同步、多使用者登入。
- 目前道路時間為 **模擬遊戲用的數值**，不是實際東京地理路線或交通時間。角色仍是規則型行為雛形，不應視為完整角色腦。
- **預設為本地儲存的靜態前端，可選擇本機 Node 伺服器權威世界**，尚無伺服器端資料庫或帳號系統。不能把使用者裝置內的存檔當作已同步到 GitHub。

## 執行

安裝 Node.js 20+（無需執行 `npm install`，本專案無外部 npm 依賴）。

```bash
npm run dev          # http://localhost:4173
npm test             # 核心模擬器測試
npm run build        # 產生 dist/ 靜態站點
```

`dist/` 可放上 GitHub Pages、Cloudflare Pages 或其他靜態主機；此儲存庫目前**不會自動發布**，以免意外更動任何正式網站。

## 安全

不提交 `.env`、API keys、密碼、存取權杖、資料庫快照、使用者上傳檔案。儲存資料目前存在瀏覽器本機，不會發送到原 Sites 網站或 GitHub。

## 實作限制與方向

原網站此工作階段無法直接讀取或截圖，因此視覺與互動細節是依據既有需求**新設計**。Rebuild 0.2 本地 Node 測試已涵蓋路網、存檔、線索與行為；Chromium 在此執行環境回報 `ERR_BLOCKED_BY_ADMINISTRATOR`，**無法宣稱真實瀏覽器操作驗收通過**。後續需要實際畫面與可觀測的流程比對，才能做到介面一致；世界事件引擎需持續擴建，不能將現有簡易決策邏輯宣稱為原站完整角色腦。

## Rebuild 0.2 工程記錄（2026-11-22）

- 新增 `src/core/routes.js` 和 `tests/exploration.test.mjs`、`tests/storage.test.mjs`。
- 確認與修正：事件不瞬移角色；人物觀察、交流、調查有明確前因；觀察者以實際路徑走訪並保留進房紀錄；v1→v2 存檔遷移；離線與分段推進一致性；日志 ID 唯一。
- `npm run check`：21/21 測試通過、靜態建置成功。
- 未完成：取得原站畫面做逐頁比對、前端真實瀏覽器自動化、雲端存檔與完整跨作品事件與角色資料。
- 安全：不保存／提交任何環境秘密；原 Sites 正式站沒有改動、沒有重新部署。

## Rebuild 0.3：wRITE 角色腦轉接層（實驗階段）

直接使用 [wRITE](https://github.com/day2561124-art/wRITE) 的真實 Node.js 能力模組，而不是複製寫另一套角色腦。`vendor/wRITE` 是固定 commit 的 Git submodule。現在已完成感知、認知、行動候選接線與安全的 World 行動採納；**尚未完成 Native Loop、長期記憶/經驗提交及正式的線上角色選擇器**。現階段預設不啟用遠端決策，遊戲依然能用既有離線規則。

詳見 [`docs/CHARACTER-BRAIN-INTEGRATION.md`](docs/CHARACTER-BRAIN-INTEGRATION.md)。Node.js 上游不能直接在靜態 GitHub Pages 上執行。

## Rebuild 0.5：wRITE Native Turn（可選）

新增 `BRAIN_NATIVE=1` 的 Native 單回合模式。它呼叫上游 `runWorldSimulationTurn`，
保留 wRITE session、在私有索引中保存 lineage，讓上游管理角色認知／回合歷史。
只有配置獨立 `BRAIN_SELECTOR_MODULE` 決策提供者時才會啟用。
**此版本不是完整的世界後果雙向同步**：Native 提交意圖，米花現有 World 才判定
實際行動與存檔。後續需以伺服器權威世界狀態完成雙向提交，方能宣稱完整 Native 閉環。
參見 [整合文件](docs/CHARACTER-BRAIN-INTEGRATION.md)。


## Rebuild 0.5｜角色行動後果的本機回報閉環

角色腦的 Native 決定仍只提交**行動意圖**；不是米花 World 的成功判定。米花觀察模擬器以本機存檔為權威，經 `applyBrainDecision` 寫入一筆 `brainOutcomes` 待追蹤紀錄，後續世界時間真的發生「抵達／調查完成／證據不足／觀察／逾時中斷」時，才將這筆紀錄改為 ready。中途移動不構成抵達，調查者必須在現場留下自身調查紀錄才算完成。

前端保存本機世界後，透過 `POST /api/brain/feedback` 回送與已提交決策綁定的結果。伺服器拒絕無效角色、時間倒退、錯誤地點、未選擇過的行動與互相矛盾的重複回報；同一回饋可安全重試。未連線時保留 ready，重新連線後補送。若未完成/未送達的紀錄達到容量上限，新角色腦決策會拒絕新增而不是暗中丟失資料。

下個原生角色回合會把相應回報列入**該角色的主觀／待核對資訊**。這裡不會直接修改上游 `memories` 表，也不會把瀏覽器回報當作 `wRITE` 原生已核實的 World Experience Receipt。

限制：此版為**單人本機預覽**，缺乏伺服器權威的米花世界快照、帳戶身分驗證及可跨裝置的世界持久化。現有 `BRAIN_SELECTOR_MODULE` 仍需由營運者設定，不會假裝自行擁有 LLM API。這些限制未解除前，不開放公網多人服務。


## Rebuild 0.6｜伺服器權威世界（可選）

在 `npm run dev` 本機預覽中，可直接建立「伺服器世界」，或在舊世界設定頁明確將瀏覽器存檔移轉（舊存檔會保留備份）。伺服器負責時間推進、路網、場景觀察、日誌及角色腦決策的原子持久化，使用版本 + SHA-256 拒絕過期寫入；以 HTTP API **拒絕瀏覽器自行覆寫既有世界快照**。

由伺服器產生並保存的角色後果可送回 wRITE 下一次原生回合；舊瀏覽器回饋仍只當未驗證的主觀資料。這是後果驗證前移，不代表完整上游 Experience Receipt、長期學習或所有 NPC 已自主思考。需要自行設定 `BRAIN_NATIVE=1` 及受信任的決策提供者。此段為 Rebuild 0.6 當時的能力界線；後續版本已加入 Node 背景世界時鐘。正式登入／跨裝置同步／多使用者隔離仍未完成。**不得直接公開部署**。

完整限制及 API 見 [`docs/CHARACTER-BRAIN-INTEGRATION.md`](docs/CHARACTER-BRAIN-INTEGRATION.md)。


## Rebuild 0.7：Native 多 NPC 背景回合

- 適用於 **本機 Node 伺服器權威世界**，使用固定版 `wRITE` Native Loop 與由營運者另行設定的 `BRAIN_SELECTOR_MODULE`。沒有選擇器時無法啟用 Native 模式，既有離線規則模式不受影響。
- Node 伺服器在持續運行時會每 5 秒檢查一次已啟用、未暫停的世界，按現有世界速度推進模擬時間，單次最多推進 120 遊戲分鐘。**不使用無限制離線追趕，不宣稱伺服器關機時仍在模擬。**
- 角色腦依固定每輪最多 3 人、依儲存的輪替游標挑選 NPC。各角色接收自己的感知與可行動清單；僅接受 Native 已提交且有有效決策憑證的意圖。World 按路網與事件自行判定結果。
- 啟用 Native 模式時不再由原本的排程規則額外選擇人物的新目的地、社交或調查，但移動、睡眠、體力變化與現場感知仍由 World 裁定。角色既有行動尚未結算時不能再次決策。
- 分世界序列化寫入。某世界的一名角色腦發生錯誤時會隔離該 NPC 本輪失敗；其他 NPC 和其他世界可繼續運行。伺服器保存世界版本及幂等操作紀錄，重新啟動仍可從上次提交狀態恢復。
- 頁面在伺服器模式只讀取最新世界狀態，不再與伺服器同時競爭推進 Native 世界時間。瀏覽器隱藏時 Node 模擬不會自行停止，但 Node 服務關閉後不會運行。
- **經驗界線**：米花 World 後果經伺服器驗證、去重並交給既有 Native 後續認知流程；這還不是 wRITE 正式的 post-outcome Experience Receipt、長期記憶形成或自動學習驗證。本輪不宣稱已完成完整學習閉環。
- 本功能仍限本機可信單使用者 localhost。未完成跨行程檔案鎖、登入授權、跨裝置雲端同步、外部模型提供者配置與依賴安全修補，不可直接公開部署。

驗證：`npm run check`，以及 GitHub 上游流程實際拉取固定版 `vendor/wRITE` 執行原生多角色回合測試（本機沒有子模組時測試必須跳過而不能冒稱通過）。


## Rebuild 0.8：已驗證後果進入 wRITE 正式主觀記憶形成入口

- 伺服器確實提交的個人行動結果，在**下一個該角色的原生回合**作為可閱讀的個人歷史紀錄進入 `observable_by[character].visual`，由 wRITE 正式感知與 Phase63A 主觀記憶形成流程決定是否編碼。米花**不直接修改** wRITE 的 `memories`、自我模型或信念。
- 原本來自瀏覽器本機存檔、未經權威伺服器核實的回報仍只能留在 `guessed`，不會升級成上述已驗證的感知紀錄。不同角色的紀錄先按 `actor_id` 隔離；不讓路過的 NPC 知道別人的行動紀錄。
- 新增真實上游 CI 斷言：伺服器世界先產生經驗 → 完成 wRITE 下一個原生回合 → 上游提交新主觀記憶紀錄；另驗證兩人經驗不混用。測試失敗則不可聲稱 Native 學習驗收完成。
- **已形成主觀記憶 ≠ 自動證明檢索、語義學習或 wRITE 官方 post-outcome Experience Receipt 已完成。** 須另測實際 Phase63C 取回、目標/決策差異與 Phase76 內建的 post-outcome 主觀經驗接線。伺服器尚未具備公網多人安全條件。

## Rebuild 0.12：Phase63C 已有來源的經驗取回

`server/memory-retrieval.mjs` 將固定版上游已有的 Phase63C `memoryRetrievalResolver` 接入 Mi Native Loop。它只選取原生 Phase63A 已經編碼、符合下一步思考目標的本角色伺服器驗證行動紀錄；取回由上游執行，不能作者式補寫回憶，也不能把臨時讀取冒充記憶取回。上游 CI 新增已形成記憶但禁止檢索，與允許真實檢索後的第三回合選擇對照。這只是狹義的記憶取回功能，非 Phase76 全面知識學習或長期記憶鞏固。

## Rebuild 0.12：伺服器後果的 Phase76A/76B 正式來源接線

`server/post-outcome.mjs` 使用固定版 `wRITE` 的 Phase76A canonical projection 和 Phase76B hash-verified memory bridge。只有伺服器已結算並經 `acknowledgeAuthoritative` 的結果，且保存了原始 NPC 名稱、動作與決策身分，才能建立收據。結果區分成功抵達、完成查看、未證實與中斷，中斷不能被宣告為已完成。

收據寫入伺服器私有 Native index，隔次 Native 回合由 Phase76B 重新驗證並交到 `other_senses`，再由 `wRITE` Phase63A 形成記憶。這**不是**米花自己直接寫 `wRITE.memories`。早期缺少行動描述的歷史回饋沿用 v0.9 說明文字，不偽造正式收據。已提交收據有 hash 驗證與跨重啟去重，不能傳給其他角色。

Phase63C 有新的 `episodic_action_experience` 來源檢索條件，不能把當回合正在感知的結果同時當回憶。這是受控的跨回合記憶來源流程，不等於 `wRITE` native action commit 已直接擁有米花的 World 實際因果提交，也不代表長期記憶鞏固、獨立學習或無模型的自主決策已完成。

本機需 `npm run check`；正式 Phase76A/B 與兩名 NPC 記憶隔離，必須在 GitHub Actions 以固定版 `vendor/wRITE` 執行 `tests/brain-native-upstream.test.mjs` 驗收。正式站仍需登入授權、跨行程持久鎖與上游安全審核。原 Sites 網站不受本工程影響。


## Rebuild 0.12：World × Native 跨系統提交對帳

- 新增 `server/reconciliation-ledger.mjs`。每筆伺服器結算的行動在 Native ACK 之後，必須取得綁定世界、角色、決策、行動、結果、時間和來源的 `receipt_id` 與 `evidence_hash`；這是**伺服器內部對帳識別**，不是簽章，也不代表來自未驗證客戶端的證據已變可靠。
- World 保存順序為「世界結果 `ready` 已經落盤 → Native inbox 接受回執 → 回執證據核對 → World 標記 `delivered` 並保存證據」。若在 Native ACK 後但 World 保存前中斷，保留 `ready`，重新連接後由 Native 去重回覆同一張回執，再完成 World 提交。若 Native 未接受、回執不符，**不可**標記送達。
- `GET /api/worlds/<id>/reconciliation-status` 僅於原本 localhost / 同源限制下提供整數統計及錯誤代碼，不包含私有角色內容；報告 `verified`、`ready`、`legacy` 與 `issues`。可偵測已標記完成的上游回執遺失，但**不擅自改寫世界歷史**。舊版沒有 ACK 證據的 `delivered` 紀錄繼續可讀，會標示為 `MI_LEGACY_UNPROVEN_DELIVERY`，不會偽裝成已對帳。
- NPC 的某項回執失敗會留在待送清單，其他角色可以繼續同步。該 NPC 在 `pending` 或 `ready` 尚未結束時，不會接受下一項新決策。直接決策也會核對 Native 的 committed、actor、world minute、decision ID。
- 對帳不再重設世界 `savedAt`。Native 已經提交認知回合、而米花未記帳時，橋接可根據上游正式回合歷史恢復同一決策，避免再次選擇。
- `reconciliationHooks` 及 `recoveryHooks` 為只供本地測試注入的斷點。單元測試覆蓋 Native 前中斷、Native ACK 與 World 標記之間中斷、Native turn 提交後中斷、回執篡改、多角色錯誤隔離、舊紀錄與遺失收據的對帳檢測；GitHub 上游測試另用固定版真正 wRITE 驗證 Phase76 receipt 不會因重試變成兩段記憶。

限制：上述為**單一可信 localhost Node 程序、兩個可持久化儲存層**的可重試一致性機制，並非跨伺服器 ACID 分散式交易。沒有多程序/多主機共享鎖、身分登入、正式備份復原、收據加密簽署，以及通用長期學習的驗證，不能直接開放公網。


## Rebuild 0.12：多世界長時間持久化壓力測試

- `npm run stress` 獨立執行 2,000 次伺服器 World 回合、4 個獨立世界、每回合至多 3 名 NPC 的正式世界行動提交。測試的 Native 決策端與收件匣為**故障注入替身**，不是 6,000 次真實模型推論；真實 wRITE 的接線仍由上游固定版 GitHub CI 單獨驗證。
- 測試注入角色腦暫時故障、回執接受前中斷、接受後至米花提交前的崩潰、重新建立 WorldStore、重送操作、時鐘回撥；檢查世界時間、個別角色決策、回執去重及可恢復的待對帳資料。
- `BEIKA_STRESS_TICKS=400 npm run stress` 為 CI 限額壓力驗收（約 1,200 筆角色決策）；本地可用預設的 2,000 回合深入驗收。一般 `npm run check` 仍只執行快速單元與建置測試。
- 伺服器存檔改為**先建立並同步完整暫存檔，再原子更名或獨占 hard link 發布**，並於支援的平台同步資料夾，避免將部分寫入的世界當成有效存檔；寫入時間戳不得因系統時鐘回撥而倒退。
- 仍只支援單一 Node 程序與本機預覽。此測試**不等於**多主機交易、真的關機斷電、雲端授權隔離、真實模型連續 6,000 回合或角色通用自我學習已經驗收。

詳細測試方法與限制見 `docs/STRESS-AND-RECOVERY.md`。


## Rebuild 0.13：真實 wRITE 多 NPC 長期整合驗收

新增獨立的 Native Endurance GitHub CI，使用鎖定版本的上游實體程式，驗證三名 NPC 持續決策、已確認世界後果、Phase76/Phase63 記憶與多次重新啟動。另有真正米花 World 提交的受控回憶對照組。測試用的選擇器是固定規則，不是已完成完全自主的 AI；原 2,000 回合模擬壓測也沒有改稱為真實 AI 回合。

執行：`WRITE_ROOT=/absolute/path/to/wRITE BEIKA_NATIVE_TICKS=8 npm run native-stress`。
本機無上游時會明確跳過，正式結論以 GitHub 上游 CI 的結果為準。正式 Sites 保持不動。


## Rebuild 0.14：Native 歷史讀取與成本追蹤

正常 Native 決策改為先持久保存 `inflight_event_id`，避免米花橋接每回合額外重讀整份上游歷史；舊索引及崩潰復原仍需查詢正式上游歷史。索引採原子發布、檔案同步與支援平台的目錄同步，不改動 `wRITE` 內部記憶及歷史。長跑測試新增 `BEIKA_NATIVE_PHASE_TIMES`，逐輪量測上游呼叫與時間成本。此修正僅針對米花多餘的讀取，不能在測量前宣稱已解決上游隨歷史累積的效能問題。



## Rebuild 0.15：世界模擬與角色腦分離

- 未暫停的**伺服器權威世界**現在由 Node 伺服器背景時鐘推進，即使未設定 Native 角色腦或沒有開啟瀏覽器分頁，也能進行一般 NPC 作息、移動、局部互動、線索與原作時間線事件。此時不宣稱 NPC 由完整角色腦思考。
- 若世界已明確啟用 Native，行動意圖仍由原生 `wRITE` 回合與外部選擇器提供；失去決策提供者不會悄悄切回規則型角色。世界實際結果仍由米花 World 判定。
- 伺服器世界的瀏覽器只會輪詢已保存狀態，不會自行提交重複的背景 `advance` 或頁面顯示時的 `catchup`。明確的走訪、查看、手動推進仍可發送伺服器指令。
- **前提仍是 Node 程序在運行**。若電腦關機或伺服器停止，沒有任何常駐背景模擬；再次啟動的離線補算目前受到單次 120 遊戲分鐘的限制，尚需與瀏覽器本機模式的七天上限另行統一。
- 此變更沒有部署或更改原 Sites，沒有存取實際電腦存檔，也不是雲端多裝置同步。

## Rebuild 0.16：多世界排程隔離

- Node 背景排程改採**每世界一個進行中工作**，不再因單一 Native 角色腦長時間思考而鎖住其他世界的定時掃描。
- 全部進行中的世界工作數不得超過 `maxWorlds`，輪替掃描仍保留公平性；同一世界由 WorldStore 的序列化佇列與 revision/hash 檢查防止手動指令、排程與重試互相覆寫。
- 普通世界即使另一世界 Native 提供者卡住，仍按自身時鐘推進。原本啟用 Native 的世界不會偷換成普通規則；失敗時保留可觀察的錯誤代碼。
- 測試利用受控等待的 Native 提供者，核對至少三個後續排程區間、其他世界持續推進、單世界不重疊、整體工作數上限、手動操作競態及復原後的時間防重複計算。
- 這是本機單 Node 程序的排程隔離；停止或關閉 Node，背景模擬仍不會持續。未部署原 Sites，也沒有搬動使用者電腦的實際存檔。

## Rebuild 0.17：Native 長跑效能量測

- 目前已確認 3 NPC、8 輪的真實 Native 回合有明顯的非線性耗時增長；同上游固定版兩次 GitHub CI 的第 8 輪約為 103～127 秒，**問題尚未解決**。
- 先補上不更動角色判斷與 World 因果的量測：CPU 耗時、heap、World state 位元組數、角色記憶筆數，以及決策與 Phase63C 取回回呼耗時；避免無證據地縮減記憶或關閉上游能力。
- 設有極寬鬆的嚴重性能退步測試門檻，不能將通過視作長期放置模擬的效能已達標。
- 研究證據、版本差異及下一步完整紀錄在 [Native 效能分析](docs/NATIVE-PERFORMANCE-PROFILE.md)；追蹤於 [Issue #14](https://github.com/day2561124-art/Mi/issues/14)。

## Rebuild 0.18：CPU 函式層級診斷

- GitHub 長跑驗收另外對第 1 與第 8 輪使用 Node V8 CPU Profiler，輸出脫敏後的函式 self/inclusive 取樣排名；遊戲執行路徑不啟用。
- 只確認上游 Native 計算瓶頸，不改寫角色記憶或因果提交，不宣稱效能問題已修好。
- 詳細說明與量測限制見 [Native 長跑效能分析](docs/NATIVE-PERFORMANCE-PROFILE.md)，追蹤 [Issue #14](https://github.com/day2561124-art/Mi/issues/14)。

## Rebuild 0.19：Phase82A 歷史深拷貝效能修補

- 固定已合併的通用 `wRITE` PR #58（`cbbd76f5`），在 Phase82A 每次建立時保留一份獨立且經 JSON 正規化的歷史快照，減少對每個逐步增長的歷史前綴重複深層複製。
- 三名原著 NPC、八輪的受控實測，第 8 輪由約 104 秒降至約 59 秒；測試中仍驗證 24 筆回執、兩次重啟與 Phase63C 記憶對後續行動的作用。此為單組 GitHub runner 比對，非普遍保證。
- 效能尚未達到長期放置所需的水準，第 8 輪仍為第 1 輪約 59 倍，Issue #14 繼續開啟。詳見 [Native 效能分析](docs/NATIVE-PERFORMANCE-PROFILE.md)。

## Rebuild 0.20：精簡 World History 儲存

- 固定已合併的通用 `wRITE` PR #62（`47212ea5`），把歷史檔案的縮排 JSON 改成不損失欄位的精簡 JSON。既有縮排存檔繼續可讀，未變更 World State、回合證據、雜湊演算法與交易防護。
- 在 Node 22、三名原著 NPC、八輪及啟用 CPU 取樣的測試中，第八輪從前一正式版約 60.2 秒降至候選版約 40.5 秒（單組 GitHub runner A/B 觀察；不是所有機器都保證）。
- 仍驗證 24 筆回執、兩次重啟、角色記憶隔離及 Phase63C 回憶影響行動。第八輪仍比第一輪慢約 48.6 倍，Issue #14 仍開啟。詳見 [Native 效能分析](docs/NATIVE-PERFORMANCE-PROFILE.md)。

## Rebuild 0.21：非睡眠回合的歷史解析修補

- 候選通用修補 [wRITE PR #64](https://github.com/day2561124-art/wRITE/pull/64) 避免一般非睡眠提交為睡眠／清醒狀態驗證而重讀整份歷史，**驗證器依然每回合執行**。真正的睡眠轉換仍須讀取完整歷史核對來源，世界歷史的正式提交亦持續讀取最新檔案。
- 米花 [PR #26](https://github.com/day2561124-art/Mi/pull/26) 用原有三名原著 NPC、八輪、24 回執、兩次重啟與 Phase63C 記憶對照做 A/B：候選版第八輪 35.30 秒，上版正式合併 pin 第八輪 50.21 秒。**第一輪候選版亦快得多，因此不能把整體縮短直接歸因於本修補**；跨 runner 的單次數字不是效能保證。
- 第八輪相對第一輪仍是約 55 倍，Issue #14 持續開啟。詳見 [Native 效能分析](docs/NATIVE-PERFORMANCE-PROFILE.md)。

## Rebuild 0.22：Phase82A 空歷史來源診斷

- 固定已合併的通用 [wRITE PR #69](https://github.com/day2561124-art/wRITE/pull/69)（`13adaeb5`）：只有在歷史中完全**不存在** Phase81Q 封包時，才省去不會被使用的完整歷史深拷貝。只要有舊 Phase81Q（即使證據為空），仍執行完整來源核對；目前不更動角色認知結果。
- 米花長跑新增測試後統計 `BEIKA_NATIVE_Q_DENSITY`，只輸出證據封包的總數，不輸出私人角色內容。實測 47 個歷史回合中有 24 個 Phase81Q 封包、**0 個包含真正證據**。因此此短路在後段 Native 長跑不會生效，不能宣稱它解決米花效能問題。
- 原始候選測試 [CI 45186270683](https://github.com/day2561124-art/Mi/actions/runs/45186270683) 第八輪約 58.18 秒，前一正式版 [CI 45178243715](https://github.com/day2561124-art/Mi/actions/runs/45178243715) 約 47.26 秒；執行器負載不一，這不是可靠的退步證明，也沒有支持加速的證據。下一階段需研究**已有來源驗證但沒有經驗記錄**的封包重建成本。詳見 [Native 效能分析](docs/NATIVE-PERFORMANCE-PROFILE.md)，Issue #14 繼續開啟。

## Rebuild 0.23：Phase82A 同回合隔離快照

- 正式固定通用 [wRITE PR #74](https://github.com/day2561124-art/wRITE/pull/74)（`149fe762`）：在一次 World 解析中，Phase82A/B/C/D 共用**單一完整 JSON 正規化、深層凍結的歷史快照**，但每次仍重新驗證當前與全部舊 Phase81Q 的來源、雜湊及防偽規則。未建立跨回合快取、未刪歷史與記憶。
- 米花使用 3 名原著 NPC、8 輪、24 筆回執、兩次重啟與 Phase63C 記憶對照。候選 [Native CI](https://github.com/day2561124-art/Mi/actions/runs/45189989450) 第八輪 **42.15 秒**，前一正式版 [CI](https://github.com/day2561124-art/Mi/actions/runs/45187598701) **57.36 秒**；Phase82A 深拷貝 CPU 取樣由約 14.6 秒降到 1.8 秒。這是單次跨 runner 觀測，並非所有裝置都能達成相同降幅。
- 第八輪仍比第一輪慢 **36.5 倍**；長期效能 Issue #14 仍開啟。詳見 [Native 效能分析](docs/NATIVE-PERFORMANCE-PROFILE.md)。

## 工程紀錄歸屬與上游同步

- 只在 `Mi` 保存米花原著人物、遊戲時間線、劇情、角色記憶與專屬長跑測試；目前使用柯南、毛利蘭、灰原哀進行原生介面測試，固定規則的選擇器**不代表**已驗證角色完全自主。
- `wRITE` 只維護通用認知與 World 因果機制。跨儲存庫問題可以引用最少量可公開的測試證據，但不得把米花情節、角色存檔或個別工程流水帳遷入通用角色腦。詳見 `docs/PROJECT-BOUNDARIES.md`。
- 通用認知修補需先通過其自身受影響測試與跨平台驗收；米花僅固定已合併的正式上游 SHA，再用本遊戲專屬的 Native 長跑複驗。
