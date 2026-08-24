import type { SyncAction, VaultLocalState } from '../types';

/** Client-規格書第 3 節：同一個 path 安靜 1～2 秒沒有再變動才進入合併。 */
export const DEBOUNCE_MS = 1500;

export type RawEventKind = 'create' | 'modify' | 'delete';

function kindToAction(kind: RawEventKind): SyncAction {
	switch (kind) {
		case 'create':
			return 'CREATE';
		case 'modify':
			return 'MODIFY';
		case 'delete':
			return 'DELETE';
	}
}

/**
 * 依 Client-規格書第 4 節的表格，把一個新事件合併進 `state.syncQueue`。
 *
 * `baseVersion`：規格書表格只講了 CREATE 固定為 0；MODIFY/DELETE 新增一列時的
 * baseVersion 取自 `state.fileVersions[path]`（見 types.ts 對 `fileVersions` 欄位
 * 的說明，這是實作時補上、規格書沒有明講存放位置的「目前已知版本」）。
 *
 * `existing.action === 'DELETE'` 之後又收到新事件（例如刪除後又快速重建），
 * 規格書表格沒有涵蓋這個組合；這裡採取合理延伸：視為在被刪除前的版本基礎上
 * 重新修改，把佇列列改成 MODIFY、baseVersion 沿用已知版本，而不是當成全新
 * CREATE（避免和伺服器端「路徑已存在」的 CREATE 唯一性檢查衝突）。
 */
export function mergeQueueItem(state: VaultLocalState, path: string, kind: RawEventKind): void {
	const action = kindToAction(kind);
	const queue = state.syncQueue;
	const idx = queue.findIndex((item) => item.path === path);
	const now = Date.now();
	const knownVersion = state.fileVersions[path] ?? 0;

	if (idx === -1) {
		queue.push({
			path,
			mutationId: crypto.randomUUID(),
			action,
			baseVersion: action === 'CREATE' ? 0 : knownVersion,
			updatedAt: now,
		});
		return;
	}

	const existing = queue[idx]!;

	if (existing.action === 'MODIFY' && action === 'MODIFY') {
		existing.updatedAt = now;
		existing.mutationId = crypto.randomUUID();
		return;
	}
	if (existing.action === 'CREATE' && action === 'MODIFY') {
		existing.updatedAt = now;
		existing.mutationId = crypto.randomUUID();
		return; // action 維持 CREATE，baseVersion 不變
	}
	if (existing.action === 'CREATE' && action === 'DELETE') {
		queue.splice(idx, 1); // 整列移除，不進入推送
		return;
	}
	if (
		(existing.action === 'MODIFY' || existing.action === 'CREATE') &&
		action === 'DELETE'
	) {
		existing.action = 'DELETE';
		existing.updatedAt = now;
		existing.mutationId = crypto.randomUUID();
		return;
	}
	if (existing.action === 'DELETE' && (action === 'CREATE' || action === 'MODIFY')) {
		// 規格書表格未涵蓋：刪除後又重建/修改，見上方函式註解。
		existing.action = 'MODIFY';
		existing.baseVersion = knownVersion;
		existing.updatedAt = now;
		existing.mutationId = crypto.randomUUID();
		return;
	}
	// existing.action === 'DELETE' && action === 'DELETE'：已經是 DELETE，只更新時間戳。
	existing.updatedAt = now;
}

interface QueueTarget {
	/** 事件發生當下應該寫入哪個 vaultId 的佇列；尚未解析過 vaultId 時回傳 null。 */
	getVaultState(): VaultLocalState | null;
	onQueueChanged(): void;
}

/**
 * 監聽 vault 事件、debounce、合併進佇列。第一次成功解析出 vaultId 之前發生的
 * 事件不會被追蹤（見 Client-規格書第 9 節「首次安裝 plugin 時的初始化流程」
 * 尚未定案；在定案前，這是刻意接受的已知限制，而不是遺漏)。
 */
export class SyncQueueManager {
	private target: QueueTarget;
	private timers = new Map<string, number>();
	private pendingKinds = new Map<string, RawEventKind>();

	constructor(target: QueueTarget) {
		this.target = target;
	}

	onVaultEvent(path: string, kind: RawEventKind): void {
		this.pendingKinds.set(path, kind);
		const existingTimer = this.timers.get(path);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}
		const handle = window.setTimeout(() => {
			this.timers.delete(path);
			const finalKind = this.pendingKinds.get(path);
			this.pendingKinds.delete(path);
			if (finalKind) this.commit(path, finalKind);
		}, DEBOUNCE_MS);
		this.timers.set(path, handle);
	}

	/** rename 拆成對舊路徑 DELETE、對新路徑 CREATE，各自獨立走合併規則。 */
	onRenameEvent(oldPath: string, newPath: string): void {
		this.onVaultEvent(oldPath, 'delete');
		this.onVaultEvent(newPath, 'create');
	}

	/** Client-規格書第 6 節：觸發同步前，強制結束所有還在計時中的 debounce。 */
	flushAll(): void {
		const pending = new Map(this.pendingKinds);
		for (const handle of this.timers.values()) {
			window.clearTimeout(handle);
		}
		this.timers.clear();
		this.pendingKinds.clear();
		for (const [path, kind] of pending) {
			this.commit(path, kind);
		}
	}

	/** plugin onunload 時呼叫，只清計時器，不強制合併（避免在卸載當下寫入狀態）。 */
	dispose(): void {
		for (const handle of this.timers.values()) {
			window.clearTimeout(handle);
		}
		this.timers.clear();
		this.pendingKinds.clear();
	}

	private commit(path: string, kind: RawEventKind): void {
		const state = this.target.getVaultState();
		if (!state) return;
		mergeQueueItem(state, path, kind);
		this.target.onQueueChanged();
	}
}
