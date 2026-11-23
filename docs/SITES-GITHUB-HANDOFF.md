# GitHub → ChatGPT Sites：非正式部署連線測試

本測試**只驗證 GitHub Actions 可以建置並輸出可供 Work/Codex 審核的靜態候選檔**，不呼叫 ChatGPT Sites 的部署、資料庫或存檔介面。

## 已知目標

- 原 Sites 專案：`appgprj_6affa67227cc8191aeb0a29b451af36a`
- 原正式網站：`https://beika-stage.merebeacon.chatgpt.site/`
- GitHub 程式庫：`day2561124-art/Mi`

## 為什麼不能直接自動發布

1. 本庫是依需求重新建構，不是 Sites 第 35 版的正式原始碼。**不得將建置成果直接覆蓋原正式站**。
2. GitHub Actions 工作流程僅執行 `npm run check` 並上傳 `dist/`，它是**靜態前端**；Node 伺服器的 Native World、角色腦與權威存檔並不包含於此檔案。
3. 本庫尚無經 Sites 平台驗證的 `.openai/hosting.json` 關聯、正式 D1/R2 資料綁定、可用的 Sites 發布認證流程或 GitHub push → Sites 自動部署路徑。
4. 官方 Sites 流程仍需在有權限的 ChatGPT Work / Codex 環境中檢查相容性、儲存候選版本、再發布。GitHub Actions 的成功只代表**候選成品建置成功**。

## 本測試的邊界

- 工作流程名稱：`Sites handoff preflight (no deployment)`。
- 觸發方式：Pull Request，或 GitHub Actions 頁面手動執行。
- 產物：7 天保留的 `mi-static-candidate`。
- **不會**建立或修改 Sites 專案、更新原網域、存取任何玩家資料庫、清空或遷移存檔、加入任何部署密鑰。
- 合併與正式發布均需另外審核，不能把這份預檢當作上線驗收。

## 在 Work / Codex 的下一段唯讀驗證

請從原 Sites 專案的編輯入口開啟，並提供下列任務：

> 唯讀檢查原有《米花大舞台 有命你就來》Sites 專案
> `appgprj_6affa67227cc8191aeb0a29b451af36a`，
> 比較 GitHub `day2561124-art/Mi` 當前分支的實際建置輸出、
> Sites 原站版本與資料庫綁定。不得建立新網站、不得部署、
> 不得修改任何正式資料。確認 Git 原始碼是否可關聯**原專案**；
> 若可，先儲存未發布候選版本，回報候選版本 ID、來源 commit、
> 原有儲存資源保留情況及不相容處。

官方參考：[管理 Sites 的版本與 Git 關聯](https://learn.chatgpt.com/docs/sites/managing-a-site)；當地原始碼專案可使用 `.openai/hosting.json` 維護 `project_id`，但必須在 Sites 完成權限與相容性檢查後由其正確建立／確認，不應僅憑已知 ID 宣稱完成連線。
