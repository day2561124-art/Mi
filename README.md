# 米花大舞台 有命你就來

> **遷移準備中：尚未匯入原 Sites 的完整原始碼。請勿視為可部署的網站。**

原正式站：https://beika-stage.merebeacon.chatgpt.site/

原 Sites 專案：`appgprj_6affa67227cc8191aeb0a29b451af36a`

## 2026-11-22 匯出狀態

- 原 Sites 原始碼、前端、後端、`package.json`、原始設定檔、資料庫 schema、正式站靜態資源：**未取得**
- 實際玩家紀錄、存檔、使用者上傳檔案與秘密環境值：**未匯出，也不應提交到公開 GitHub**
- 歷史 v35 柯南 TV883–900 的續接資料另備份於 ChatGPT，**不是遊戲源碼**
- 正式站：**未修改、未部署**
- 此儲存庫暫為準備區，待具備原 Sites 專案授權的 Codex 或 Sites 工作階段匯出後再補齊

## 正式遷移要求

原 Site 的實際原始碼應包含可重建的完整前後端、依賴和 lockfile、設定範本、資料庫結構/migrations、遊戲系統、角色、世界、地圖、事件排程、存檔與讀檔邏輯。請在提交前檢查秘密值與機敏玩家資料。

不要提交 `.env`、API 金鑰、私鑰、密碼、存取權杖、玩家存檔及使用者上傳檔案。Schema 與匿名安全的測試資料可依需求經審核保留。

來源的版本號與 commit 必須由 Sites 實際工作樹核對。先前交接資料聲稱 v35，尚未證明現在仍是該版。

## 建議匯出方式

OpenAI 官方說明：可由具有原站存取權的 **Codex** 匯出 Sites 原始碼。務必要求只匯出，不修改、發布或遷移正式站資料。

https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites
