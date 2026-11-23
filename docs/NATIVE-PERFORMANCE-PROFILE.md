# Native 長期執行效能分析（Issue #14）

更新：2026-11-23。這是**固定版上游與受控測試資料**的量測紀錄，不等於玩家實際遊玩速度，也不代表由 GPT 模型自主做出選擇。樣本使用米花的柯南、毛利蘭、灰原哀、固定 `wait` 決策器、每輪三角色、每輪推進 30 個遊戲分鐘、總共八輪及兩次持久化重啟。

## 已知條件與可比性

- 測試皆使用相同上游 submodule `a08f2dd17474a920a7d56303b9228061588fc45d`、Node 22 GitHub Ubuntu runner、同一個 `tests/native-longrun-upstream.test.mjs` 測試情境；GitHub 的實際 runner CPU 與負荷可能不同，**不可將跨 runner 速度差當作優化效果**。
- [PR #19 的 Native CI](https://github.com/day2561124-art/Mi/actions/runs/45137545167)，執行版本含獨立世界時鐘。
- [PR #21 的 Native CI](https://github.com/day2561124-art/Mi/actions/runs/45139681462)，執行版本含世界間排程隔離；Native 測試仍直接呼叫 WorldStore，因此這兩次長跑主要是**相同工作負載的重複測量**，不是用來證明 PR #21 加速 Native。
- 更早的 [基線測試](https://github.com/day2561124-art/Mi/actions/runs/45107300587) 的 tick 8 需要 319,423 ms；當時的上游固定 SHA 為 `f6a929162082975ab7800ff7ced02438186c649b`，版本不同，不可直接與本次 103,046 ms 推算「提升幾倍」。

## 兩次相同上游 SHA 的逐輪量測

| 遊戲輪次 | PR #19 全部耗時 ms | PR #21 全部耗時 ms | PR #21 Native runWorldSimulationTurn ms | PR #21 Native commitWorldSimulationTurn ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 886 | 677 | 614 | 30 |
| 2 | 2,560 | 1,997 | 1,728 | 156 |
| 3 | 6,952 | 5,429 | 4,757 | 453 |
| 4 | 14,951 | 12,219 | 10,838 | 966 |
| 5 | 29,384 | 23,612 | 21,108 | 2,212 |
| 6 | 51,528 | 41,524 | 38,243 | 3,019 |
| 7 | 84,129 | 67,490 | 62,610 | 4,588 |
| 8 | 126,758 | 103,046 | 96,280 | 6,403 |

第八輪耗時相比第一輪增加約 143 倍（PR #19）、約 152 倍（PR #21）。PR #21 第八輪 `runWorldSimulationTurn` 佔整輪約 93.4%，`commitWorldSimulationTurn` 約 6.2%；外層米花橋接與其餘呼叫並非最大的量測區段。**此事實不能再推論 turn 內部哪個函式最慢**。

## 新增不改行為的儀表板資料

`tests/native-longrun-upstream.test.mjs` 在既有 `BEIKA_NATIVE_PHASE_TIMES` 基礎上逐輪輸出：

- `BEIKA_NATIVE_DIAGNOSTIC`：程序 CPU 耗時、Node heap used、已提交 World state 的序列化大小、三位原著角色的記憶筆數，及決策回呼/Phase63C 回憶選擇器各自呼叫次數與耗時。不輸出角色私人記憶內容。
- `BEIKA_NATIVE_PERF_GUARD`：第 8 輪相對第 1 輪耗時增長、是否超過已知不良的 40× 警示、以及寬鬆 300× 的**嚴重退步測試閾值**。300× 是防極端惡化，不是合理效能的合格標準；40× 超標只表示待修問題仍存在。
- 決策回呼與 Phase63C 回憶選擇器採計時包裝，完全沿用原決策回應與上游正式取回流程；不限制、截斷或代寫上游記憶，不改變 World 因果提交。

CPU 佔用可幫助區分計算與等待，記憶成長可協助評估資料放大的相關性。兩者都是**觀察資料，不是已證明的因果瓶頸**。第一輪建立 session 的初始化成本、重啟時的 IO/GC、不同 runner 處理器差異都可能影響相對值。

## 尚待查明

1. 在固定 `a08f2dd...` 與相同三名 NPC、相同八輪條件下，比對加裝儀表的結果與本文件的兩次未加儀表紀錄。
2. 若 CPU 成本佔比高，往上游 `prepareWorldSimulationTurn`、`resolveWorldSimulationTurn` 與 Native capability invocation 的邊界進一步取樣。上游 prepare 路徑確實呼叫 `getWorldSimulationHistory`，但單靠程式碼審查還不能證明它是最高成本。
3. 只有辨識確認可免除的重複工作時才提交效能優化；保留記憶、對帳、身分與 CAS 保證。通用 wRITE 的優化需在該上游有可重現、與米花業務無關的效能證據後獨立處理。

本文件沒有更動原 Sites 正式站、沒有用到使用者電腦的存檔，也沒有宣稱 PR #21 已解決這項效能問題。

## Rebuild 0.18：實際 V8 CPU 函式取樣（待 CI 實測）

- 測試專用 `tests/native-cpu-profiler.mjs` 用 Node 22 `node:inspector` 的 V8 `Profiler` 收集 1 ms 級取樣；只有明確設定 `BEIKA_NATIVE_CPU_PROFILE=1`，才對真實 Native 長跑的**第 1 與最後 1 輪**啟用。預設遊戲啟動完全不讀取 profiler。
- 輸出 `BEIKA_NATIVE_CPU_SAMPLE`，含總樣本時間、各函式 self（落在自身）及 inclusive（抽樣堆疊包含此函式）排名，並單獨整理 `wRITE` 上游函式。路徑一律正規化為相對於 `wRITE/`、`Mi/` 或 Node 內建模組；不印出實際執行者主目錄、私人角色記憶、完整 CPU profile 或世界存檔。
- `totalSampledMs` 是 V8 時間差取樣，不應與 `process.cpuUsage()` 或整輪 wall time 當成同一種數值。特別是 async 等待、V8 GC、JIT 編譯及 inspector 本身都可能改變觀察結果。
- CPU profile 的 self 排名可指出在樣本中「落在哪個函式」；inclusive 排名是祖先堆疊被取樣的時間，**不同函式的 inclusive 百分比不可相加**。函式排名不是因果證明，若要改動上游需搭配明確重複呼叫、狀態版本、hash/receipt 一致性與同固定 SHA 實驗。
- `tests/native-cpu-profiler.test.mjs` 驗證 V8 取樣器輸出、self/inclusive 權重、絕對路徑遮罩及無上游時的快速測試。GitHub `Pinned wRITE Native Endurance` 會使用此 opt-in 觀察模式；先保留既有 8 輪、24 回合、3 人記憶隔離、兩次重啟、Phase63C 行動對照的強制驗收。


## Rebuild 0.19：Phase82A 重複歷史深拷貝修補的 A/B 驗收

- 通用上游 [wRITE PR #58](https://github.com/day2561124-art/wRITE/pull/58) 通過受影響驗證、Windows/Ubuntu smoke，已合併為 `cbbd76f5eece4d2a4750b356880a3c4c569bff2b`。Mi 僅固定此合併 SHA，不把米花私有 NPC/世界存檔移入通用上游。
- 原版 `a08f2dd`：[Mi PR #23 CPU profiling](https://github.com/day2561124-art/Mi/actions/runs/45164847945)，第八輪耗時 **104,014 ms**；Phase82A `historyPrefix → cloneJson` **58,178 ms / 55.9% V8 取樣**。
- 修補候選 `2573f14`：[Mi PR #24 實驗性 pin CI](https://github.com/day2561124-art/Mi/actions/runs/45166546685)，第八輪耗時 **58,750 ms**；同函式 **11,759 ms / 20.0% V8 取樣**。一組 GitHub 執行器觀察到的第八輪 wall time 降幅約 43.5%，並非所有硬體都保證這個比例。
- A/B 均使用 Node 22、米花原本的柯南、毛利蘭、灰原哀、8 輪 3 NPC、固定 `wait` 選擇器、2 次重啟、24 個角色回合、相同的測試程式與 CPU profile 設定。修補版通過所有 24 筆回執驗證、角色主觀記憶隔離及 Phase63C 實際檢索影響下一動作。
- **不能結案的原因：** 第八輪仍是第一輪的 59.2×。修補後取樣的剩餘高成本包含 `cloneJson`（20.0%）、世界歷史 `readJson`（16.7%）、序列化/字串解碼（約 13.3%）及 GC（12.0%）；排名與歸因仍需要分離實驗。當前 300× guard 是災難級退步警戒，不代表放置模擬的速度已達標。
- 本次保留每個歷史回合的 Phase81Q/Phase81P 來源重驗；只是每次 Phase82A 建構先建立一次完全獨立的 JSON 正規化歷史快照，隨後在其內部用前綴陣列視圖查證，避免對日益增長的前綴重複做 JSON stringify/parse。沒有截斷歷史、沒有繞過信念/記憶形成與因果提交。


## Rebuild 0.20：精簡歷史儲存格式，第二階段實測

- 通用 [wRITE PR #62](https://github.com/day2561124-art/wRITE/pull/62) 已通過受影響 CI 及 Windows、Ubuntu smoke，合併為 `47212ea513b221a0994c6044937244c1a25a3028`。米花 PR #25 的正式 gitlink 指向此合併 SHA，而非未合併測試分支。
- 只把 `world_history.json` 寫出格式從兩格縮排的 JSON 改成精簡 JSON（尾端保留換行），不改 World State 檔、不刪內容、不增快取。讀取者原有 `JSON.parse` 可以讀取舊縮排存檔；下一次正常提交會把相同 JSON 值儲存為精簡格式。所有來源驗證、交易防護及內容雜湊仍在原本位置執行。
- 使用相同米花 Node 22 / 三名原著 NPC / 8 輪 / 2 次重新啟動 / 24 筆核對回執 / Phase63C 實際回憶對照 / V8 第 1 與第 8 輪 CPU 取樣：前一版 [CI 45167521782](https://github.com/day2561124-art/Mi/actions/runs/45167521782) 第 8 輪 **60,162 ms**；候選上游 [CI 45173768333](https://github.com/day2561124-art/Mi/actions/runs/45173768333) 第 8 輪 **40,517 ms**。單次跨 runner 觀測降幅約 **32.7%**；不是所有裝置都必然達到。
- 第八輪 `readJson` self CPU 取樣約從 9,918 ms 降至 6,313 ms；Phase82A 深拷貝仍約 8,898 ms、垃圾回收約 5,664 ms，皆須繼續定位其因果成本。
- **未解決：** 候選版第八輪仍約為第一輪 48.6×；單次測速不是充分的長期穩定性證據，Issue #14 保持開啟。下一段優先觀察 Phase82A 重複建構、跨回合歷史讀取及記憶佔用。


## Rebuild 0.21：非睡眠回合的歷史讀取短路（wRITE PR #64）

- 上游 [wRITE PR #64](https://github.com/day2561124-art/wRITE/pull/64) 對通用 `commitWorldSimulationTurn` 增加精準分流：**每一次提交仍呼叫** `assertWorldSimulationSleepArousalCommitAuthority`，但只在確實提案 `physical_state.sleep_arousal` 轉換時，才為該驗證器額外讀取整份已提交 World History。沒有提案卻偷偷更改睡眠狀態的提交仍由驗證器拒絕。後續 World History 寫入階段依舊開啟、驗證最新正式歷史；沒有引入跨回合快取。
- 米花候選 [PR #26](https://github.com/day2561124-art/Mi/pull/26) 使用相同原著角色、Node 22、8 輪、24 筆回執、兩次重啟與 CPU 取樣，在 [CI 45177285314](https://github.com/day2561124-art/Mi/actions/runs/45177285314) 第八輪耗時 **35,299 ms**；上一個已合併上游版本 [CI 45174781333](https://github.com/day2561124-art/Mi/actions/runs/45174781333) 第八輪耗時 **50,206 ms**。兩次各一個 runner 的原始觀測差異約 29.7%。
- **不能把 29.7% 當作已證明的修補效益**：第一輪候選版約 642 ms，上版為 1,094 ms，顯示測試機器或執行條件可能不同；第八輪相對第一輪仍為候選版 **55.0×**，上版 **45.9×**。CPU 的 `readJson` self 取樣也由約 7,767 ms 降為 4,425 ms，但仍不能排除 CPU/JIT/GC 變異。
- 此次確認的是確實移除無用的單次解析以及持久化與角色記憶驗證沒有退步，而非達成可長期放置的速度。Issue #14 維持開啟，下一個高成本來源仍是 Phase82A 重複歷史重建與整體狀態解析。


## Rebuild 0.22：Phase82A 歷史封包密度與真正的適用範圍

- 已合併的通用 [wRITE PR #69](https://github.com/day2561124-art/wRITE/pull/69)，正式 SHA `13adaeb5301e077e7c0c9f109e2ac68dab6e9337`，只在**沒有任何歷史 Phase81Q 封包物件**時省去無人消費的完整 JSON 歷史深拷貝。任何存在的舊 Phase81Q，包含沒有證據的封包及遭竄改的封包，仍使用之前的完全隔離複本和逐筆驗證；當前 Phase81Q 一律先執行來源核對。
- 用 Node 22、柯南／毛利蘭／灰原哀、8 輪、24 筆回執、2 次重啟、Phase63C 記憶對照測試。新增 `BEIKA_NATIVE_Q_DENSITY` 統計安排在量測回合外，只統計數量，不記錄世界或人物內容。候選 [CI 45186270683](https://github.com/day2561124-art/Mi/actions/runs/45186270683) 結果：**47 個已提交歷史回合、24 個 Phase81Q 封包、0 個真正包含證據**。
- 此工作負載大部分時間不符合「無舊 Q」短路條件，所以不能從本修補宣稱米花加速。候選第八輪為 **58,182 ms**，上一個正式版本 [CI 45178243715](https://github.com/day2561124-art/Mi/actions/runs/45178243715) 第八輪 **47,264 ms**，但兩次的第一輪也不同（1,170 vs 915 ms）；跨執行器差異不構成可歸因的效能退步或進步。
- **後續真正的效能缺口：** 存在 24 個正確的空經驗 Phase81Q 封包時，Phase82A/B/C/D 仍重建歷史的完整來源驗證，並在每次 Phase82A 建構時複製整份歷史。不能僅因 `evidence_records=[]` 就取消驗證或偽稱已驗證；需要安全的同回合重用或隔離成本優化與新的負向案例，Issue #14 保持開啟。

