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
