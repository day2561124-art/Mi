# ChatGPT Sites CLI：不用 Codex 模型推論的部署路線研究（2026-11-23）

## 目的
讓使用者從手機上的 ChatGPT 聊天送出部署要求，由聊天工具提交 GitHub 事件，GitHub Actions 建置，再更新**既有** Sites 專案（不新建網站）。

- Repo: `day2561124-art/Mi`
- Target: `appgprj_6affa67227cc8191aeb0a29b451af36a`
- Existing production: `https://beika-stage.merebeacon.chatgpt.site/`
- 目前正式站與 GitHub 重建版不是同一份原始碼，GitHub 重建版的 Native Node/World/角色腦伺服器**不會包含在靜態 dist/**。

## 查證發現
1. 第三方 `@hayatosc/sites` CLI 的 `deploy` 是本地建置、Sites source sync、儲存版本、部署、輪詢；README 說先讀 `SITES_ACCESS_TOKEN`，否則使用 `~/.codex/auth.json` 的 `tokens.access_token`。
2. CLI `deploy --dry-run` 預期不需要認證、不上傳、不更動遠端，適合先跑 GitHub Actions 的匿名驗收。
3. CLI 部署程序的設計不要求 Codex 模型推論；**尚無官方承諾 Sites 部署請求不消耗任何 ChatGPT 方案額度，不能聲稱零成本／無限次**。
4. OpenAI 官方認證文件指出，個人 Codex CLI ChatGPT 登入存於本地憑證快取；正式無人值守企業存取權杖另有 Enterprise 控制。**不要把個人的 Codex auth.json、refresh token、ChatGPT Cookie、API Key 貼到聊天室或提交到 GitHub**。
5. 第三方 CLI 並非官方支援的發佈工具。即使匿名 dry-run 通過，也不代表正式認證安全、能更新原站、可長期執行或與原 Sites DB/Worker 相容。

## 本分支的實驗
- `.github/workflows/sites-cli-anonymous-dryrun.yml`：使用 GitHub runner、只讀 repo 權限；`npm run check` 後**只在 runner 中建立臨時** `.openai/hosting.json`。
- 先檢查 `@hayatosc/sites@0.1.2` 發布版，然後用 `--prebuilt --dry-run --allow-dirty` 模擬部署封裝。
- 不提供任何 Codex 或 ChatGPT 憑證，也不執行 Sites 遠端查詢、建立版本、部署或環境變數修改。
- PR 保留審核，不合併到主線、不自動部署。

## 推進正式部署之前的必備條件
- 獨立審核 CLI 的遠端連線、token refresh 與第三方依賴；固定可驗證的套件版本與供應鏈來源。
- 確認 ChatGPT Sites 官方允許的非互動發布與適用身分憑證；若沒有支援的授權，不以個人長效登入權杖替代。
- 使用與正式站隔離的試驗 Site 做一次有憑證但不影響玩家的版本儲存、部署與回滾驗證。
- 對帳原站第 35 版功能與 GitHub 重建版，尤其後端、D1/持久化、登入與角色腦。不得因無玩家存檔便假定功能相容。
- 正式部署啟用前需執行 E2E 驗收；讓 GitHub Actions 的正式部署環境只接收受保護分支與合法的人工授權設定。

## 參考
- https://github.com/hayatosc/sites-cli
- https://github.com/hayatosc/sites-cli/blob/main/docs/deploy.md
- https://learn.chatgpt.com/docs/sites/managing-a-site
- https://learn.chatgpt.com/docs/auth?surface=cli
