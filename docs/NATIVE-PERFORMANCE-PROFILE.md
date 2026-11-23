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
