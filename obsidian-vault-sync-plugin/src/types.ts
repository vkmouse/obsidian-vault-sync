/**
 * 本地待推送佇列的一列。entityType 用 discriminated union 區分 VAULT／FILE，
 * 兩者的 payload 形狀不同，靠這個 union 在編譯期擋掉互相誤用。
 *
 * 取捨：還沒送出去的檔案被刪除時不會整列移除，而是照常標成 isDeleted=true
 * 送出去。換來合併邏輯簡化，代價是這類「建立後秒刪」的檔案會多打一次
 * API、在伺服器留一筆刪除記錄，這個成本可以接受。
 *
 * 出列順序採陣列本身順序（先進先出）：合併同一個 entityId 的後續事件是
 * in-place 更新、不會把項目搬到佇列尾端，所以本來就不需要額外時間戳來
 * 排序。VAULT command 一律用 unshift 插到最前面，確保同一批次裡一定排在
 * 引用同一個 vaultId 的 FILE command 之前——後端是依陣列順序處理的。
 */
export type SyncQueueItem =
	| {
			entityType: 'FILE';
			vaultId: string;
			entityId: string;
			mutationId: string;
			baseVersion: number;
			payload: {
				isDeleted: boolean;
			};
	  }
	| {
			entityType: 'VAULT';
			vaultId: string;
			entityId: string;
			mutationId: string;
			baseVersion: number;
			payload: Record<string, never>;
	  };

/**
 * 每個 vaultId 各自獨立保存的本地狀態。
 *
 * fileVersions 記錄每個路徑目前已知的版本號，供下次要送出 MODIFY/DELETE 時
 * 當作 baseVersion；沒有記錄的路徑視為版本 0，交給伺服器的版本檢查擋掉。
 */
export interface VaultLocalState {
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
	/** 使用者層級的全域同步游標，不再屬於某個 vaultId。 */
	globalSyncCursor: number;
	vaults: Record<string, VaultLocalState>;
}

export function createEmptyVaultLocalState(): VaultLocalState {
	return { syncQueue: [], fileVersions: {} };
}

export interface UploadObjectResponse {
	contentHash: string;
	status: 'CREATED' | 'ALREADY_EXISTS';
}

/** 對應後端 sync_events.entity_type。 */
export type EntityType = 'VAULT' | 'FILE';

export interface FilePayload {
	contentHash: string | null;
	isDeleted: boolean;
}

export interface PushCommand {
	mutationId: string;
	entityType: EntityType;
	/** VAULT：要建立的 vaultId；FILE：所屬的 vaultId。全域佇列下每筆 command 得自帶。 */
	vaultId: string;
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
	vaultId: string;
	mutationId: string;
	entityType: EntityType;
	entityId: string;
	version: number;
	/** entityType='FILE' 時可解析成 FilePayload；null 視同刪除。entityType='VAULT' 不代表檔案內容變化，不解析。 */
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
