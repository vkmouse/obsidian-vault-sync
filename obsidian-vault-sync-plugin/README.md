# obsidian-vault-sync-plugin

依照 `Client-規格書.md`（v9 + 本次決議）實作的 Obsidian plugin，搭配 `obsidian-vault-sync-cf` 後端使用。

## 安裝 / 開發

```bash
npm install
npm run dev     # watch 模式
npm run build   # 產出 main.js（含型別檢查）
npm run lint
```

把 `main.js`、`manifest.json` 複製到 `<Vault>/.obsidian/plugins/obsidian-vault-sync/` 底下，在 Obsidian 設定 → Community plugins 啟用。

## 設定畫面需要填入

- **API base URL**：`obsidian-vault-sync-cf` 部署的網域（規格書原本沒有這個欄位，本次已補進 `PluginData.apiBaseUrl`）。
- **CF-Access-Client-Id** / **CF-Access-Client-Secret**：Cloudflare Access Service Token。
- **Vault 名稱**：1–100 字元，換到伺服器端 `vaultId` 用。

## 與規格書的差異 / 實作補充（務必知悉）

1. **`fileVersions` 欄位**（`src/types.ts`）：規格書第 4 節提到 MODIFY 要用「目前已知版本」當 `baseVersion`，但 `VaultLocalState` 原本沒有存放這個版本的地方。實作補上 `fileVersions: Record<path, version>`，靠 push 成功（`OK`）時本地樂觀 +1、以及套用 `pullEvents` 時採用事件裡的 `version` 來維護。
2. **ERROR 處理（第 9.1 節，已決議）**：`pushResults` 為 `ERROR` 時，若該路徑剛好被同一批的 `pullEvents` 覆蓋，直接清除佇列列；否則保留在佇列裡等下次手動同步重試，並用 `Notice` 列出失敗的檔案路徑。
3. **403 處理（第 9.2 節，已決議）**：`sync` 端點回 403 時，清空 `resolvedVaultId`/`resolvedVaultName`，中止本次同步並提示使用者重新執行同步（下次會自動走第 5 節重新解析）。
4. **首次安裝 / vaultId 尚未解析前的事件**（規格書第 9 節列為尚未涵蓋）：本實作選擇在第一次成功解析出 `resolvedVaultId` 之前，不追蹤任何 vault 事件進佇列——也就是說剛安裝 plugin、還沒按過一次同步時，這段期間的新增/修改不會被記錄。使用者必須先完成一次成功同步（此時才會解析出 vaultId），之後的事件才會開始被追蹤。這是刻意的簡化，不是完整的「首次安裝初始化流程」，如果需要更完整的行為（例如安裝當下就把整個 vault 當作待推送內容），需要另外設計。
5. **空佇列仍會送一次 sync 請求**：規格書 8.2 沒有明講佇列是空的時候要不要呼叫 `sync`，但既然 `sync` 同時負責推送與拉取（`pullEvents`），不送請求就永遠拉不到其他裝置的更新，因此固定每次觸發同步至少呼叫一次 `sync`，即使 `pushCommands` 是空陣列。
6. **`Vault.createFolder` / `FileManager.trashFile`**：套用 `pullEvents` 的 CREATE 需要先確保上層資料夾存在、DELETE 改用 `FileManager.trashFile()` 尊重使用者的刪除偏好設定（移到系統垃圾桶 / `.trash` / 直接刪除）。這兩支 API 分別要求 Obsidian 1.4.0+ / 1.6.6+，因此 `manifest.json` 的 `minAppVersion` 設為 `1.6.6`。

## 尚未實作 / 仍待確認

- `obsidian-vault-sync-cf` 目前還沒有 `functions/api/vaults/[vaultId]/sync.ts`（`API-規格書.md` 第 7 節已經完整定義，但程式碼還沒寫），這個 plugin 在後端補上該端點前無法真正同步成功，只有 `POST /api/vaults`、`PUT`/`GET objects` 兩支端點是已經存在的。
- 規格書第 9 節其餘項目（憑證失效重新設定流程、離線大量變更、`data.json` 改用 IndexedDB 的時機）維持未定案，本次沒有處理。
