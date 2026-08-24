// 對應 Client-規格書第 1、2 節的本地儲存結構，以及第 7 節的 API request/response 形狀。

export type SyncAction = 'CREATE' | 'MODIFY' | 'DELETE';

/** 本地待推送佇列的一列，見 Client-規格書第 2 節。 */
export interface SyncQueueItem {
	path: string;
	mutationId: string;
	action: SyncAction;
	baseVersion: number;
	/** epoch ms，每次合併更新時重新寫入，決定推送順序（越舊越先送）。 */
	updatedAt: number;
}

/**
 * 每個 vaultId 各自獨立保存的本地狀態，見 Client-規格書第 1 節。
 *
 * `fileVersions` 是規格書沒有明講、但實作時必須補上的欄位：第 4 節合併規則
 * 提到「（無）| MODIFY | 新增一列，baseVersion=目前已知版本」，但規格書的
 * `VaultLocalState` 只有 `lastCursor`/`syncQueue`，沒有地方存「目前已知版本」。
 * 這裡比照 cimg-rs/JaNote 的作法：push 收到 `OK` 時本地樂觀地把該路徑版本更新為
 * `baseVersion + 1`（`DELETE` 則移除該路徑的紀錄）；套用 `pullEvents` 時直接採用
 * 事件裡的 `version`。沒有紀錄的路徑，`MODIFY`/`DELETE` 時 `baseVersion` 一律視為
 * 0（等同不知道版本），讓伺服器用版本檢查自然擋掉（結果會是 `SKIPPED`，不影響
 * 正確性，只是這筆變更需要等下次同步才會被伺服器接受版本已知的重送或使用者手動
 * 再次觸發同步）。
 */
export interface VaultLocalState {
	lastCursor: number;
	syncQueue: SyncQueueItem[];
	fileVersions: Record<string, number>;
}

/** plugin `data.json` 的頂層結構，見 Client-規格書第 1 節。 */
export interface PluginData {
	accessClientId: string;
	accessClientSecret: string;
	/** Cloudflare Pages 專案的網域，例如 https://obsidian-vault-sync-cf.pages.dev（不含結尾斜線）。 */
	apiBaseUrl: string;
	vaultName: string;
	resolvedVaultId: string | null;
	resolvedVaultName: string | null;
	vaults: Record<string, VaultLocalState>;
}

export function createEmptyVaultLocalState(): VaultLocalState {
	return { lastCursor: 0, syncQueue: [], fileVersions: {} };
}

// ---- API DTOs（見 Client-規格書第 7 節，欄位命名與後端 API-規格書一致） ----

export interface CreateVaultResponse {
	vaultId: string;
	name: string;
	status: 'CREATED' | 'ALREADY_EXISTS';
}

export interface UploadObjectResponse {
	contentHash: string;
	status: 'CREATED' | 'ALREADY_EXISTS';
}

export interface PushCommand {
	mutationId: string;
	path: string;
	action: SyncAction;
	baseVersion: number;
	contentHash?: string;
}

export interface PushResult {
	mutationId: string;
	status: 'OK' | 'SKIPPED' | 'ERROR';
}

export interface PullEvent {
	id: number;
	mutationId: string;
	path: string;
	action: SyncAction;
	version: number;
	contentHash: string | null;
	createdAt: string;
}

export interface SyncRequestBody {
	lastCursor: number;
	pushCommands: PushCommand[];
}

export interface SyncResponseBody {
	pushResults: PushResult[];
	newCursor: number;
	pullEvents: PullEvent[];
}
