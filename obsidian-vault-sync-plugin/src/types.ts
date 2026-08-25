/**
 * 本地待推送佇列的一列。
 *
 * 取捨：還沒送出去的檔案被刪除時不會整列移除，而是照常標成 isDeleted=true
 * 送出去。換來合併邏輯簡化，代價是這類「建立後秒刪」的檔案會多打一次
 * API、在伺服器留一筆刪除記錄，這個成本可以接受。
 *
 * 出列順序採陣列本身順序（先進先出）：合併同一個 entityId 的後續事件是
 * in-place 更新、不會把項目搬到佇列尾端，所以本來就不需要額外時間戳來
 * 排序。
 */
export interface SyncQueueItem {
	entityType: 'FILE';
	entityId: string;
	mutationId: string;
	baseVersion: number;
	payload: {
		isDeleted: boolean;
	};
}

/**
 * 每個 vaultId 各自獨立保存的本地狀態。
 *
 * fileVersions 記錄每個路徑目前已知的版本號，供下次要送出 MODIFY/DELETE 時
 * 當作 baseVersion；沒有記錄的路徑視為版本 0，交給伺服器的版本檢查擋掉。
 */
export interface VaultLocalState {
	lastCursor: number;
	syncQueue: SyncQueueItem[];
	fileVersions: Record<string, number>;
}

/** 序列化進 Obsidian 的 data.json，是整個 plugin 唯一持久化的狀態。 */
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

export interface CreateVaultResponse {
	vaultId: string;
	name: string;
	status: 'CREATED' | 'ALREADY_EXISTS';
}

export interface UploadObjectResponse {
	contentHash: string;
	status: 'CREATED' | 'ALREADY_EXISTS';
}

/** 對應後端 sync_events.entity_type。目前僅 'FILE'。 */
export type EntityType = 'FILE';

export interface FilePayload {
	contentHash: string | null;
	isDeleted: boolean;
}

export interface PushCommand {
	mutationId: string;
	entityType: EntityType;
	entityId: string;
	baseVersion: number;
	payload: string;
}

export interface PushResult {
	mutationId: string;
	status: 'OK' | 'SKIPPED' | 'ERROR';
}

export interface PullEvent {
	id: number;
	mutationId: string;
	entityType: EntityType;
	entityId: string;
	version: number;
	/** entityType='FILE' 時可解析成 FilePayload；null 視同刪除。 */
	payload: string | null;
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
