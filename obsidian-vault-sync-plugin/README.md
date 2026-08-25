# obsidian-vault-sync-plugin

依照 `vault-sync-mirror-spec.md`（整包 zip 鏡像同步）實作的 Obsidian plugin，搭配 `obsidian-vault-sync-cf` 後端使用。

## 安裝 / 開發

```bash
npm install
npm run dev     # watch 模式
npm run build   # 產出 main.js（含型別檢查）
npm run lint
```

把 `main.js`、`manifest.json` 複製到 `<Vault>/.obsidian/plugins/obsidian-vault-sync/` 底下，在 Obsidian 設定 → Community plugins 啟用。

## 設定畫面需要填入

- **API base URL**：`obsidian-vault-sync-cf` 部署的網域。
- **CF-Access-Client-Id** / **CF-Access-Client-Secret**：Cloudflare Access Service Token。
- **Vault 名稱**：1–100 字元，換到伺服器端 `vaultId` 用。

## 同步方式

沒有自動同步，只有兩個手動觸發的動作（command palette 或 ribbon icon）：

- **Push**：把本地 vault（含 `.obsidian`）整包打包成 zip，覆蓋遠端。
- **Pull**：下載遠端 zip，覆蓋本地；本地有、zip 沒有的檔案視為已刪除，**永久刪除、不進回收桶**。

兩者動作前都會跳確認視窗，列出這次會新增／覆蓋／刪除的檔案數，但只有數量、無法逐一檢視內容——這是整包鏡像模式的已知限制。

## 已知取捨（詳見規格書第 6、7 節）

- 沒有合併能力：兩台裝置都改了東西、其中一台還沒 pull 就 push，會讓對方已 push 的修改被整包覆蓋，沒有任何提示或保護。
- push 打包 zip 時不加鎖，直接讀取當下內容。
- `.obsidian/workspace.json` 等每裝置各異的檔案整包一起同步，多裝置間會互相覆蓋視窗狀態。
