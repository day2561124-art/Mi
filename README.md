# 米花大舞台・有命你就來 / 獨立重作

> 這是以已知功能需求與 2026-11-21 第 35 版接續資料 **重新實作** 的新專案，不是 Sites 原始碼匯出，也不是與原正式站逐頁驗證過的複製品。原 Sites 專案保持不動。

- 原正式站：https://beika-stage.merebeacon.chatgpt.site/
- Sites project ID：`appgprj_6affa67227cc8191aeb0a29b451af36a`
- 本儲存庫：https://github.com/day2561124-art/Mi
- 目前重作版本：`Rebuild 0.8`

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

由伺服器產生並保存的角色後果可送回 wRITE 下一次原生回合；舊瀏覽器回饋仍只當未驗證的主觀資料。這是後果驗證前移，不代表完整上游 Experience Receipt、長期學習或所有 NPC 已自主思考。需要自行設定 `BRAIN_NATIVE=1` 及受信任的決策提供者。此預覽尚未提供正式的登入／跨裝置同步／多使用者隔離，也不會在伺服器無使用者連線時主動持續模擬。**不得直接公開部署**。

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

## Rebuild 0.10：Phase63C 已有來源的經驗取回

`server/memory-retrieval.mjs` 將固定版上游已有的 Phase63C `memoryRetrievalResolver` 接入 Mi Native Loop。它只選取原生 Phase63A 已經編碼、符合下一步思考目標的本角色伺服器驗證行動紀錄；取回由上游執行，不能作者式補寫回憶，也不能把臨時讀取冒充記憶取回。上游 CI 新增已形成記憶但禁止檢索，與允許真實檢索後的第三回合選擇對照。這只是狹義的記憶取回功能，非 Phase76 全面知識學習或長期記憶鞏固。

## Rebuild 0.10：伺服器後果的 Phase76A/76B 正式來源接線

`server/post-outcome.mjs` 使用固定版 `wRITE` 的 Phase76A canonical projection 和 Phase76B hash-verified memory bridge。只有伺服器已結算並經 `acknowledgeAuthoritative` 的結果，且保存了原始 NPC 名稱、動作與決策身分，才能建立收據。結果區分成功抵達、完成查看、未證實與中斷，中斷不能被宣告為已完成。

收據寫入伺服器私有 Native index，隔次 Native 回合由 Phase76B 重新驗證並交到 `other_senses`，再由 `wRITE` Phase63A 形成記憶。這**不是**米花自己直接寫 `wRITE.memories`。早期缺少行動描述的歷史回饋沿用 v0.9 說明文字，不偽造正式收據。已提交收據有 hash 驗證與跨重啟去重，不能傳給其他角色。

Phase63C 有新的 `episodic_action_experience` 來源檢索條件，不能把當回合正在感知的結果同時當回憶。這是受控的跨回合記憶來源流程，不等於 `wRITE` native action commit 已直接擁有米花的 World 實際因果提交，也不代表長期記憶鞏固、獨立學習或無模型的自主決策已完成。

本機需 `npm run check`；正式 Phase76A/B 與兩名 NPC 記憶隔離，必須在 GitHub Actions 以固定版 `vendor/wRITE` 執行 `tests/brain-native-upstream.test.mjs` 驗收。正式站仍需登入授權、跨行程持久鎖與上游安全審核。原 Sites 網站不受本工程影響。
