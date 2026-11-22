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
